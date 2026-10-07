import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ExtensionInstallation,
  ExtensionInstallationDocument,
  ExtensionLifecycleStatus,
  ExtensionRevocationReason,
} from '../schemas/extension-installation.schema';
import {
  FacebookConnection,
  FacebookConnectionDocument,
  FacebookConnectionStatus,
  FacebookConnectionWorkerStatus,
} from '../schemas/facebook-connection.schema';
import {
  PublishingJob,
  PublishingJobDocument,
  PublishingJobStatus,
} from '../schemas/publishing-job.schema';
import {
  ExtensionLifecycleActor,
  ExtensionLifecycleAuditDocument,
  ExtensionLifecycleAuditEvent,
  ExtensionLifecycleAuditEventName,
} from '../schemas/extension-lifecycle-audit.schema';
import {
  generateInstallationCredential,
  hashInstallationCredential,
  maskExtensionInstanceId,
  verifyInstallationCredential,
} from './installation-credential';

/** Heartbeats run once per minute; two minutes is the initial online window. */
export const EXTENSION_ONLINE_WINDOW_MS = 2 * 60 * 1000;

/** Short-lived one-time reconnect approval lifetime. */
export const RECONNECT_APPROVAL_TTL_MS = 10 * 60 * 1000;

export type RecoveryCandidate = {
  connectionId: string;
  displayName?: string;
  facebookUserId?: string;
  activeInstallationOnline: boolean;
};

/**
 * The explicit outcome returned to the extension after registration. A revoked
 * or removed installation is never reactivated by ordinary worker traffic.
 */
export type RegistrationOutcome =
  | { status: 'ACTIVE'; connectionId: string | null; credentialIssued?: string }
  | { status: 'PAUSED'; connectionId: string | null; credentialIssued?: string }
  | { status: 'REVOKE_PENDING'; connectionId: string | null }
  | { status: 'REVOKED'; reason: string }
  | { status: 'NEW_INSTALLATION'; connectionId: string | null; credentialIssued: string }
  | { status: 'RECOVERY_AVAILABLE'; candidates: RecoveryCandidate[] };

export type ConnectionConnectivity = {
  isOnline: boolean;
  connectivity: 'ONLINE' | 'OFFLINE';
  connectivityReason: 'HEARTBEAT_RECENT' | 'HEARTBEAT_EXPIRED' | 'HEARTBEAT_MISSING';
};

/** Worker statuses the heartbeat must preserve rather than collapse to ONLINE. */
const PERSISTENT_HEARTBEAT_STATUSES = new Set<FacebookConnectionWorkerStatus>([
  FacebookConnectionWorkerStatus.PUBLISHING,
  FacebookConnectionWorkerStatus.BLOCKED,
  FacebookConnectionWorkerStatus.LOGIN_REQUIRED,
  FacebookConnectionWorkerStatus.ACCOUNT_MISMATCH,
  FacebookConnectionWorkerStatus.CHECKPOINT_OR_VERIFICATION,
  FacebookConnectionWorkerStatus.CAPTCHA_OR_CHALLENGE,
  FacebookConnectionWorkerStatus.MANUAL_INTERVENTION_REQUIRED,
]);

export function deriveConnectivity(
  lastHeartbeat: Date | string | null | undefined,
  now = new Date(),
): ConnectionConnectivity {
  if (!lastHeartbeat) {
    return {
      isOnline: false,
      connectivity: 'OFFLINE',
      connectivityReason: 'HEARTBEAT_MISSING',
    };
  }
  const timestamp =
    lastHeartbeat instanceof Date
      ? lastHeartbeat.getTime()
      : new Date(lastHeartbeat).getTime();
  const fresh =
    !Number.isNaN(timestamp) &&
    now.getTime() - timestamp <= EXTENSION_ONLINE_WINDOW_MS;
  return fresh
    ? {
        isOnline: true,
        connectivity: 'ONLINE',
        connectivityReason: 'HEARTBEAT_RECENT',
      }
    : {
        isOnline: false,
        connectivity: 'OFFLINE',
        connectivityReason: 'HEARTBEAT_EXPIRED',
      };
}

type ConnectionState = {
  _id: string;
  clerkUserId: string;
  displayName: string | null;
  facebookUserId: string | null;
  detectedFacebookUserId: string | null;
  status: FacebookConnectionStatus;
  workerStatus: FacebookConnectionWorkerStatus;
  facebookSessionDetected: boolean;
  lastSeenAt?: Date;
  extensionInstanceId: string | null;
  extensionInstanceIdMasked: string;
  activeExtensionInstallationId: string | null;
  lifecycle: ExtensionLifecycleStatus | null;
  installationStatus: ExtensionLifecycleStatus | null;
  lastHeartbeat: Date | null;
  isOnline: boolean;
  connectivity: 'ONLINE' | 'OFFLINE';
  connectivityReason: string;
  archivedAt: Date | null;
  archivedByClerkUserId: string | null;
  archiveReason: string | null;
  hasPendingReconnectApproval: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Structural slice of a lean FacebookConnection (the subset the dashboard uses). */
type LeanFacebookConnection = {
  _id: Types.ObjectId | { toString(): string };
  clerkUserId: string;
  displayName?: string | null;
  facebookUserId?: string | null;
  detectedFacebookUserId?: string | null;
  status: FacebookConnectionStatus;
  workerStatus: FacebookConnectionWorkerStatus;
  facebookSessionDetected?: boolean;
  lastSeenAt?: Date;
  extensionInstanceId?: string | null;
  activeExtensionInstallationId?: Types.ObjectId | string | null;
  reconnectApprovalTokenHash?: string;
  reconnectApprovalExpiresAt?: Date;
  reconnectApprovalUsedAt?: Date;
  archivedAt?: Date | null;
  archivedByClerkUserId?: string | null;
  archiveReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Structural slice of a lean ExtensionInstallation. */
type LeanExtensionInstallation = {
  _id: Types.ObjectId | { toString(): string };
  clerkUserId: string;
  extensionInstanceId?: string | null;
  facebookConnectionId?: Types.ObjectId | string | null;
  status?: ExtensionLifecycleStatus | null;
  lastHeartbeat?: Date | null;
};

type ConnectionLike = FacebookConnectionDocument | LeanFacebookConnection;
type InstallationLike =
  | ExtensionInstallationDocument
  | LeanExtensionInstallation;

function isRevocationReason(value: unknown): value is ExtensionRevocationReason {
  return (
    typeof value === 'string' &&
    Object.values(ExtensionRevocationReason).includes(value as ExtensionRevocationReason)
  );
}

@Injectable()
export class ExtensionsService {
  private readonly logger = new Logger(ExtensionsService.name);

  constructor(
    @InjectModel(ExtensionInstallation.name)
    private readonly extensionModel: Model<ExtensionInstallationDocument>,
    @InjectModel(FacebookConnection.name)
    private readonly connectionModel: Model<FacebookConnectionDocument>,
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(ExtensionLifecycleAuditEvent.name)
    private readonly auditModel: Model<ExtensionLifecycleAuditDocument>,
  ) {}

  private getInstallationFilter(clerkUserId: string, extensionInstanceId?: string) {
    const normalizedInstanceId = extensionInstanceId?.trim();
    return normalizedInstanceId
      ? { clerkUserId, extensionInstanceId: normalizedInstanceId }
      : { clerkUserId };
  }

  private getConnectionFilter(clerkUserId: string, extensionInstanceId?: string) {
    const normalizedInstanceId = extensionInstanceId?.trim();
    return normalizedInstanceId
      ? { clerkUserId, extensionInstanceId: normalizedInstanceId }
      : { clerkUserId };
  }

  private upsertConnection(
    clerkUserId: string,
    extensionInstanceId: string,
    updates: Record<string, unknown> = {},
  ) {
    const setOnInsert: Record<string, unknown> = {
      clerkUserId,
      extensionInstanceId,
    };

    if (!Object.prototype.hasOwnProperty.call(updates, 'status')) {
      setOnInsert.status = FacebookConnectionStatus.PENDING;
    }
    if (!Object.prototype.hasOwnProperty.call(updates, 'workerStatus')) {
      setOnInsert.workerStatus = FacebookConnectionWorkerStatus.OFFLINE;
    }
    if (!Object.prototype.hasOwnProperty.call(updates, 'facebookSessionDetected')) {
      setOnInsert.facebookSessionDetected = false;
    }

    return this.connectionModel
      .findOneAndUpdate(
        this.getConnectionFilter(clerkUserId, extensionInstanceId),
        {
          $set: {
            ...updates,
            lastSeenAt: new Date(),
          },
          $setOnInsert: setOnInsert,
        },
        { returnDocument: 'after', upsert: true },
      )
      .exec();
  }

  // ── Worker identity ───────────────────────────────────────────────────────

  /**
   * Authenticates a worker request by instance ID plus the revocable
   * installation credential (when one has been issued) and rejects revoked
   * installations. This is the shared gate for every worker API surface.
   */
  async verifyWorkerIdentity(
    clerkUserId: string | undefined,
    extensionInstanceId: string | undefined,
    credential?: string,
  ): Promise<ExtensionInstallationDocument> {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId)
      throw new UnauthorizedException('x-extension-instance-id header is required');

    const installation = await this.extensionModel
      .findOne({
        clerkUserId,
        extensionInstanceId: normalizedInstanceId,
      })
      .exec();
    if (!installation)
      throw new UnauthorizedException(
        'Extension installation is not registered. Please register first.',
      );

    if (installation.status === ExtensionLifecycleStatus.REVOKED) {
      throw new ForbiddenException(
        `Extension installation has been revoked${
          installation.revocationReason
            ? ` (${installation.revocationReason})`
            : ''
        }.`,
      );
    }
    this.assertCredentialValid(installation, credential);
    return installation;
  }

  private assertCredentialValid(
    installation: ExtensionInstallationDocument,
    credential?: string,
  ) {
    // Installations with no credential yet (legacy, pre-rollout) keep working
    // for one transition; the next register issues a credential. Every
    // installation that has been issued one fails closed.
    if (!installation.credentialHash) return;

    if (installation.credentialRevokedAt) {
      throw new ForbiddenException('Installation credential has been revoked.');
    }
    if (!credential) {
      throw new ForbiddenException('x-extension-credential header is required.');
    }
    if (!verifyInstallationCredential(credential, installation.credentialHash)) {
      throw new ForbiddenException('Installation credential is invalid.');
    }
  }

  private async resolveWorkerConnection(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
  ): Promise<FacebookConnectionDocument | null> {
    if (installation.facebookConnectionId) {
      const byBinding = await this.connectionModel
        .findById(installation.facebookConnectionId)
        .exec();
      if (byBinding) return byBinding;
    }
    if (installation.extensionInstanceId) {
      return this.connectionModel
        .findOne({
          clerkUserId,
          extensionInstanceId: installation.extensionInstanceId,
        })
        .exec();
    }
    return null;
  }

  /**
   * Claim gate helper: a worker may only claim work (or keep acting on it)
   * through the connection it is currently the active binding for, provided
   * that connection is not archived. Returns null otherwise.
   */
  async resolveActiveWorkerConnection(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
  ): Promise<FacebookConnectionDocument | null> {
    const connection = await this.resolveWorkerConnection(clerkUserId, installation);
    if (!connection || connection.archivedAt) return null;
    if (
      connection.activeExtensionInstallationId &&
      String(connection.activeExtensionInstallationId) !== String(installation._id)
    ) {
      return null;
    }
    return connection;
  }

  /**
   * New publishing and maintenance claims require an ACTIVE lifecycle. Paused
   * and disconnecting installations stay connected but cannot pick up work.
   */
  assertInstallationActive(installation: ExtensionInstallationDocument): void {
    if (installation.status === ExtensionLifecycleStatus.ACTIVE) return;
    if (installation.status === ExtensionLifecycleStatus.PAUSED) {
      throw new ForbiddenException(
        'Extension is paused and cannot claim new work.',
      );
    }
    if (installation.status === ExtensionLifecycleStatus.REVOKE_PENDING) {
      throw new ForbiddenException(
        'Extension is disconnecting and cannot claim new work.',
      );
    }
    throw new ForbiddenException(
      'Extension is not active and cannot claim new work.',
    );
  }

  private async updateConnectionForWorker(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
    updates: Record<string, unknown>,
  ): Promise<FacebookConnectionDocument | null> {
    const connection = await this.resolveWorkerConnection(clerkUserId, installation);
    if (!connection) return null;
    // A removed connection must never be refreshed back onto the dashboard.
    if (connection.archivedAt) return connection;
    connection.set(updates);
    connection.lastSeenAt = new Date();
    return connection.save();
  }

  private async recordAudit(
    event: ExtensionLifecycleAuditEventName,
    details: {
      clerkUserId: string;
      installation?: ExtensionInstallationDocument | null;
      connectionId?: Types.ObjectId | string;
      actor: ExtensionLifecycleActor;
      previousLifecycle?: string;
      nextLifecycle?: string;
      reason?: string;
    },
  ) {
    try {
      await this.auditModel.create({
        clerkUserId: details.clerkUserId,
        facebookConnectionId: details.connectionId,
        extensionInstanceIdMasked: details.installation
          ? maskExtensionInstanceId(details.installation.extensionInstanceId)
          : undefined,
        actor: details.actor,
        event,
        previousLifecycle: details.previousLifecycle,
        nextLifecycle: details.nextLifecycle,
        reason: details.reason,
      });
    } catch (error) {
      // Audit is diagnostic; a failure must not roll back the lifecycle action.
      this.logger.warn(
        `Lifecycle audit write failed for ${event}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Registers an installation and returns an explicit outcome. A revoked
   * installation is never reactivated; a known PAUSED installation stays paused.
   */
  async register(
    clerkUserId: string,
    extensionInstanceId?: string,
    extensionName?: unknown,
    credential?: string,
  ): Promise<RegistrationOutcome> {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId)
      throw new UnauthorizedException('x-extension-instance-id header is required');

    const installation = await this.extensionModel
      .findOne({
        clerkUserId,
        extensionInstanceId: normalizedInstanceId,
      })
      .exec();

    if (!installation) {
      return this.registerNewInstallation(
        clerkUserId,
        normalizedInstanceId,
        extensionName,
      );
    }

    if (installation.status === ExtensionLifecycleStatus.REVOKED) {
      return {
        status: 'REVOKED',
        reason:
          installation.statusReason ??
          installation.revocationReason ??
          'This installation was disconnected from PostFlow.',
      };
    }

    this.assertCredentialValid(installation, credential);

    const { connectionId, credentialIssued } = await this.touchLiveInstallation(
      clerkUserId,
      normalizedInstanceId,
      installation,
      extensionName,
    );

    const finalized = await this.maybeFinalizeRevocation(installation);
    if (finalized) {
      return {
        status: 'REVOKED',
        reason:
          installation.statusReason ??
          installation.revocationReason ??
          'This installation was disconnected from PostFlow.',
      };
    }
    if (installation.status === ExtensionLifecycleStatus.PAUSED) {
      return {
        status: 'PAUSED',
        connectionId,
        ...(credentialIssued ? { credentialIssued } : {}),
      };
    }
    if (installation.status === ExtensionLifecycleStatus.REVOKE_PENDING) {
      return { status: 'REVOKE_PENDING', connectionId };
    }
    return {
      status: 'ACTIVE',
      connectionId,
      ...(credentialIssued ? { credentialIssued } : {}),
    };
  }

  private async registerNewInstallation(
    clerkUserId: string,
    extensionInstanceId: string,
    extensionName?: unknown,
  ): Promise<RegistrationOutcome> {
    const connection = await this.upsertConnection(clerkUserId, extensionInstanceId, {
      workerStatus: FacebookConnectionWorkerStatus.ONLINE,
    });
    await this.updateConnectionName(clerkUserId, extensionInstanceId, extensionName);

    const now = new Date();
    const credential = generateInstallationCredential();
    const installation = await this.extensionModel.create({
      clerkUserId,
      extensionInstanceId,
      status: ExtensionLifecycleStatus.ACTIVE,
      statusChangedAt: now,
      lastHeartbeat: now,
      facebookConnectionId: connection?._id,
      facebookSessionDetected: false,
      credentialHash: hashInstallationCredential(credential),
      credentialVersion: 1,
      credentialIssuedAt: now,
    });

    if (connection?._id) {
      await this.connectionModel.updateOne(
        { _id: connection._id },
        { $set: { activeExtensionInstallationId: installation._id } },
      );
      installation.facebookConnectionId = connection._id;
      await installation.save();
    }

    await this.recordAudit(ExtensionLifecycleAuditEventName.INSTALLATION_REGISTERED, {
      clerkUserId,
      installation,
      connectionId: connection?._id,
      actor: ExtensionLifecycleActor.WORKER,
      previousLifecycle: undefined,
      nextLifecycle: ExtensionLifecycleStatus.ACTIVE,
    });

    return {
      status: 'NEW_INSTALLATION',
      connectionId: connection?._id ? String(connection._id) : null,
      credentialIssued: credential,
    };
  }

  /**
   * Refresh liveness for a known non-revoked installation. The lifecycle never
   * moves BACK to ACTIVE from here — that is the core reactivation guard.
   */
  private async touchLiveInstallation(
    clerkUserId: string,
    normalizedInstanceId: string,
    installation: ExtensionInstallationDocument,
    extensionName?: unknown,
  ): Promise<{ connectionId: string | null; credentialIssued?: string }> {
    installation.lastHeartbeat = new Date();
    let credentialIssued: string | undefined;
    if (!installation.credentialHash) {
      const credential = generateInstallationCredential();
      installation.credentialHash = hashInstallationCredential(credential);
      installation.credentialVersion = (installation.credentialVersion ?? 0) + 1;
      installation.credentialIssuedAt = new Date();
      credentialIssued = credential;
    }

    let connection = await this.resolveWorkerConnection(clerkUserId, installation);
    const workerStatusUpdates = {
      workerStatus: this.nextHeartbeatWorkerStatus(connection?.workerStatus),
    };
    if (connection && !connection.archivedAt) {
      connection.set(workerStatusUpdates);
      connection.lastSeenAt = new Date();
      installation.facebookConnectionId = connection._id;
      if (
        !connection.activeExtensionInstallationId ||
        String(connection.activeExtensionInstallationId) ===
          String(installation._id)
      ) {
        connection.activeExtensionInstallationId = installation._id;
      }
      await connection.save();
    } else if (!connection) {
      connection = await this.upsertConnection(
        clerkUserId,
        normalizedInstanceId,
        workerStatusUpdates,
      );
      installation.facebookConnectionId = connection?._id;
      if (connection && !connection.activeExtensionInstallationId) {
        await this.connectionModel.updateOne(
          { _id: connection._id },
          { $set: { activeExtensionInstallationId: installation._id } },
        );
      }
    }

    await this.updateConnectionName(clerkUserId, normalizedInstanceId, extensionName);
    await installation.save();

    return {
      connectionId: connection?._id ? String(connection._id) : null,
      ...(credentialIssued ? { credentialIssued } : {}),
    };
  }

  private nextHeartbeatWorkerStatus(
    existing: FacebookConnectionWorkerStatus | undefined,
  ): FacebookConnectionWorkerStatus {
    if (existing && PERSISTENT_HEARTBEAT_STATUSES.has(existing)) return existing;
    return FacebookConnectionWorkerStatus.ONLINE;
  }

  /**
   * Updates the heartbeat timestamp without ever changing the lifecycle. A
   * PAUSED installation stays paused; a REVOKE_PENDING installation may
   * finalize to REVOKED when its leases have expired.
   */
  async heartbeat(
    clerkUserId: string,
    extensionInstanceId?: string,
    extensionName?: unknown,
    credential?: string,
  ) {
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const normalizedInstanceId = installation.extensionInstanceId;
    if (!normalizedInstanceId)
      throw new UnauthorizedException('x-extension-instance-id header is required');

    installation.lastHeartbeat = new Date();
    const existingConnection = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );
    const connection = await this.updateConnectionForWorker(clerkUserId, installation, {
      workerStatus: this.nextHeartbeatWorkerStatus(existingConnection?.workerStatus),
    });
    if (connection) {
      installation.facebookConnectionId = connection._id;
    }
    await this.updateConnectionName(clerkUserId, normalizedInstanceId, extensionName);
    await installation.save();
    await this.maybeFinalizeRevocation(installation);

    return {
      status: installation.status,
      connectionId: installation.facebookConnectionId
        ? String(installation.facebookConnectionId)
        : null,
      isOnline: deriveConnectivity(installation.lastHeartbeat).isOnline,
    };
  }

  async updateWorkerStatus(
    clerkUserId: string,
    extensionInstanceId?: string,
    credential?: string,
    workerStatus?: FacebookConnectionWorkerStatus,
    reason?: string,
  ) {
    if (!Object.values(FacebookConnectionWorkerStatus).includes(
      workerStatus as FacebookConnectionWorkerStatus,
    )) {
      throw new BadRequestException('Invalid extension worker status');
    }
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const connectionStatus = mapWorkerStatusToConnectionStatus(workerStatus!);
    const connection = await this.updateConnectionForWorker(clerkUserId, installation, {
      workerStatus,
      ...(connectionStatus ? { status: connectionStatus } : {}),
      ...(reason ? { statusReason: reason.slice(0, 500) } : {}),
    });
    if (!connection) {
      throw new NotFoundException('Facebook connection not found.');
    }
    return this.sanitizeConnection(connection);
  }

  async updateSession(
    clerkUserId: string,
    extensionInstanceId?: string,
    credential?: string,
    sessionDetected?: boolean,
    detectedFacebookUserId?: string,
  ): Promise<{
    installation: Record<string, unknown>;
    connection: Record<string, unknown>;
  }> {
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const normalizedFacebookUserId = detectedFacebookUserId?.trim() || undefined;
    const existingConnection =
      await this.resolveWorkerConnection(clerkUserId, installation);
    const expectedFacebookUserId = existingConnection?.facebookUserId?.trim();
    const identityMismatch = sessionDetected && (
      !normalizedFacebookUserId ||
      Boolean(
        expectedFacebookUserId && expectedFacebookUserId !== normalizedFacebookUserId,
      )
    );
    const shouldBindIdentity = Boolean(
      sessionDetected && normalizedFacebookUserId && !expectedFacebookUserId,
    );

    const connectionStatus = !sessionDetected
      ? FacebookConnectionStatus.LOGIN_REQUIRED
      : identityMismatch
        ? FacebookConnectionStatus.ACCOUNT_MISMATCH
        : FacebookConnectionStatus.CONNECTED;
    const workerStatus = !sessionDetected
      ? FacebookConnectionWorkerStatus.LOGIN_REQUIRED
      : identityMismatch
        ? FacebookConnectionWorkerStatus.ACCOUNT_MISMATCH
        : existingConnection &&
            new Set([
              FacebookConnectionWorkerStatus.PUBLISHING,
              FacebookConnectionWorkerStatus.BLOCKED,
              FacebookConnectionWorkerStatus.CHECKPOINT_OR_VERIFICATION,
              FacebookConnectionWorkerStatus.CAPTCHA_OR_CHALLENGE,
              FacebookConnectionWorkerStatus.MANUAL_INTERVENTION_REQUIRED,
            ]).has(existingConnection.workerStatus)
          ? existingConnection.workerStatus
          : FacebookConnectionWorkerStatus.IDLE;

    const connection = await this.updateConnectionForWorker(clerkUserId, installation, {
      status: connectionStatus,
      workerStatus,
      facebookSessionDetected: Boolean(sessionDetected),
      ...(normalizedFacebookUserId
        ? { detectedFacebookUserId: normalizedFacebookUserId }
        : {}),
      ...(shouldBindIdentity
        ? { facebookUserId: normalizedFacebookUserId }
        : {}),
    });
    if (!connection) {
      throw new NotFoundException('Facebook connection not found.');
    }

    installation.facebookSessionDetected = Boolean(sessionDetected);
    installation.lastHeartbeat = new Date();
    await installation.save();

    return {
      installation: this.sanitizeInstallation(installation),
      connection: this.sanitizeConnection(connection),
    };
  }

  async rename(
    clerkUserId: string,
    extensionInstanceId?: string,
    credential?: string,
    extensionName?: unknown,
  ) {
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const normalizedInstanceId = installation.extensionInstanceId;
    if (!normalizedInstanceId)
      throw new UnauthorizedException('x-extension-instance-id header is required');
    await this.updateConnectionName(clerkUserId, normalizedInstanceId, extensionName);
    const connection = await this.resolveWorkerConnection(clerkUserId, installation);
    if (!connection)
      throw new NotFoundException('Facebook connection not found.');
    return { displayName: connection.displayName ?? null };
  }

  // ── Lifecycle mutations (dashboard, owner-authorized) ─────────────────────

  async pauseConnection(clerkUserId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(clerkUserId, connectionId);
    const installation = await this.findBoundInstallation(connection);
    if (!installation)
      throw new ConflictException(
        'No active extension installation is bound to this connection.',
      );
    if (installation.status === ExtensionLifecycleStatus.REVOKED)
      throw new ConflictException(
        'This installation is disconnected. Reconnect it before pausing.',
      );
    if (installation.status === ExtensionLifecycleStatus.PAUSED) {
      return this.toConnectionState(connection, installation);
    }

    const previous = installation.status;
    installation.status = ExtensionLifecycleStatus.PAUSED;
    installation.statusChangedAt = new Date();
    installation.statusChangedByClerkUserId = clerkUserId;
    installation.statusReason = undefined;
    await installation.save();

    await this.recordAudit(ExtensionLifecycleAuditEventName.INSTALLATION_PAUSED, {
      clerkUserId,
      installation,
      connectionId: connection._id,
      actor: ExtensionLifecycleActor.DASHBOARD,
      previousLifecycle: previous,
      nextLifecycle: ExtensionLifecycleStatus.PAUSED,
    });

    return this.toConnectionState(connection, installation);
  }

  async resumeConnection(clerkUserId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(clerkUserId, connectionId);
    const installation = await this.findBoundInstallation(connection);
    if (!installation)
      throw new ConflictException(
        'No active extension installation is bound to this connection.',
      );
    if (installation.status === ExtensionLifecycleStatus.REVOKED) {
      throw new ConflictException(
        'A disconnected installation cannot be resumed. Reconnect it from the Archived view.',
      );
    }
    if (installation.status === ExtensionLifecycleStatus.ACTIVE) {
      return this.toConnectionState(connection, installation);
    }

    const previous = installation.status;
    installation.status = ExtensionLifecycleStatus.ACTIVE;
    installation.statusChangedAt = new Date();
    installation.statusChangedByClerkUserId = clerkUserId;
    installation.statusReason = undefined;
    await installation.save();

    await this.recordAudit(ExtensionLifecycleAuditEventName.INSTALLATION_RESUMED, {
      clerkUserId,
      installation,
      connectionId: connection._id,
      actor: ExtensionLifecycleActor.DASHBOARD,
      previousLifecycle: previous,
      nextLifecycle: ExtensionLifecycleStatus.ACTIVE,
    });

    return this.toConnectionState(connection, installation);
  }

  async disconnectConnection(
    clerkUserId: string,
    connectionId: string,
    force = false,
  ) {
    const connection = await this.requireOwnedConnection(clerkUserId, connectionId);
    const installation = await this.findBoundInstallation(connection);
    if (!installation)
      throw new ConflictException(
        'No active extension installation is bound to this connection.',
      );
    if (installation.status === ExtensionLifecycleStatus.REVOKED) {
      return this.toConnectionState(connection, installation);
    }

    if (force) {
      await this.revokeInstallation(installation, {
        reason: ExtensionRevocationReason.USER_DISCONNECTED,
        byClerkUserId: clerkUserId,
        actor: ExtensionLifecycleActor.DASHBOARD,
      });
      await this.clearConnectionBindingIfSame(connection, installation);
      return this.toConnectionState(connection, installation);
    }

    if (installation.status !== ExtensionLifecycleStatus.REVOKE_PENDING) {
      installation.status = ExtensionLifecycleStatus.REVOKE_PENDING;
      installation.statusChangedAt = new Date();
      installation.statusChangedByClerkUserId = clerkUserId;
      installation.statusReason = ExtensionRevocationReason.USER_DISCONNECTED;
      await installation.save();
      await this.recordAudit(
        ExtensionLifecycleAuditEventName.DISCONNECT_REQUESTED,
        {
          clerkUserId,
          installation,
          connectionId: connection._id,
          actor: ExtensionLifecycleActor.DASHBOARD,
          previousLifecycle: installation.status,
          nextLifecycle: ExtensionLifecycleStatus.REVOKE_PENDING,
        },
      );
    }

    // If nothing is being processed, finalize immediately to REVOKED.
    await this.maybeFinalizeRevocation(installation);
    return this.toConnectionState(connection, installation);
  }

  async removeConnection(clerkUserId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(clerkUserId, connectionId);
    const installation = await this.findBoundInstallation(connection);

    if (installation && installation.status !== ExtensionLifecycleStatus.REVOKED) {
      await this.revokeInstallation(installation, {
        reason: ExtensionRevocationReason.REMOVED,
        byClerkUserId: clerkUserId,
        actor: ExtensionLifecycleActor.DASHBOARD,
      });
      await this.clearConnectionBindingIfSame(connection, installation);
    }

    if (!connection.archivedAt) {
      connection.archivedAt = new Date();
      connection.archivedByClerkUserId = clerkUserId;
      connection.archiveReason = ExtensionRevocationReason.REMOVED;
      await connection.save();
      await this.recordAudit(ExtensionLifecycleAuditEventName.CONNECTION_ARCHIVED, {
        clerkUserId,
        installation,
        connectionId: connection._id,
        actor: ExtensionLifecycleActor.DASHBOARD,
        reason: ExtensionRevocationReason.REMOVED,
      });
    }

    return this.toConnectionState(connection, installation);
  }

  async issueReconnectApproval(clerkUserId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(clerkUserId, connectionId);
    const token = generateInstallationCredential();
    const now = new Date();
    connection.reconnectApprovalTokenHash = hashInstallationCredential(token);
    connection.reconnectApprovalRequestedAt = now;
    connection.reconnectApprovalExpiresAt = new Date(
      now.getTime() + RECONNECT_APPROVAL_TTL_MS,
    );
    connection.reconnectApprovalUsedAt = undefined;
    await connection.save();

    return {
      connectionId: String(connection._id),
      approvalToken: token,
      expiresAt: connection.reconnectApprovalExpiresAt,
      ttlSeconds: RECONNECT_APPROVAL_TTL_MS / 1000,
    };
  }

  /**
   * Validates and marks used a one-time reconnect approval. Consumed by the
   * reinstall recovery flow (Phase 9).
   */
  async consumeReconnectApproval(
    clerkUserId: string,
    connectionId: string,
    approvalToken: string,
  ) {
    const connection = await this.requireOwnedConnection(clerkUserId, connectionId);
    if (!connection.reconnectApprovalTokenHash || !connection.reconnectApprovalExpiresAt) {
      throw new ForbiddenException('No reconnect approval is pending.');
    }
    if (connection.reconnectApprovalUsedAt) {
      throw new ForbiddenException('This reconnect approval has already been used.');
    }
    if (connection.reconnectApprovalExpiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('This reconnect approval has expired.');
    }
    if (!verifyInstallationCredential(approvalToken, connection.reconnectApprovalTokenHash)) {
      throw new ForbiddenException('This reconnect approval is invalid.');
    }
    connection.reconnectApprovalUsedAt = new Date();
    await connection.save();
    return connection;
  }

  // ── Listing with derived connectivity ─────────────────────────────────────

  async listConnections(clerkUserId: string): Promise<ConnectionState[]> {
    const [connections, installations] = await Promise.all([
      this.connectionModel
        .find({ clerkUserId, archivedAt: null })
        .sort({ lastSeenAt: -1, createdAt: -1 })
        .lean()
        .exec(),
      this.extensionModel
        .find({ clerkUserId })
        .sort({ lastHeartbeat: -1 })
        .lean()
        .exec(),
    ]);
    const installationByConnectionId = buildInstallationMap(
      connections as LeanFacebookConnection[],
      installations as LeanExtensionInstallation[],
    );
    return connections.map((connection) => {
      const boundId = connection.activeExtensionInstallationId
        ? String(connection.activeExtensionInstallationId)
        : null;
      const installation =
        (boundId
          ? installationByConnectionId.get(boundId)
          : undefined) ??
        installationByConnectionId.get(connection._id?.toString?.()) ??
        bestInstallationForConnection(
          (installations as LeanExtensionInstallation[]).filter(
            (inst) =>
              inst.facebookConnectionId &&
              String(inst.facebookConnectionId) === connection._id?.toString(),
          ),
        );
      return this.toConnectionState(connection, installation);
    });
  }

  async listArchivedConnections(clerkUserId: string): Promise<ConnectionState[]> {
    const [connections, installations] = await Promise.all([
      this.connectionModel
        .find({ clerkUserId, archivedAt: { $ne: null } })
        .sort({ archivedAt: -1 })
        .lean()
        .exec(),
      this.extensionModel
        .find({ clerkUserId })
        .sort({ lastHeartbeat: -1 })
        .lean()
        .exec(),
    ]);
    const installationByConnectionId = buildInstallationMap(
      connections as LeanFacebookConnection[],
      installations as LeanExtensionInstallation[],
    );
    return connections.map((connection) => {
      const boundId = connection.activeExtensionInstallationId
        ? String(connection.activeExtensionInstallationId)
        : null;
      const installation =
        (boundId
          ? installationByConnectionId.get(boundId)
          : undefined) ??
        installationByConnectionId.get(connection._id?.toString?.()) ??
        bestInstallationForConnection(
          (installations as LeanExtensionInstallation[]).filter(
            (inst) =>
              inst.facebookConnectionId &&
              String(inst.facebookConnectionId) === connection._id?.toString(),
          ),
        );
      return this.toConnectionState(connection, installation);
    });
  }

  private toConnectionState(
    connection: ConnectionLike,
    installation?: InstallationLike | null,
  ): ConnectionState {
    const instanceId = installation?.extensionInstanceId ?? connection.extensionInstanceId;
    const connectivity = deriveConnectivity(installation?.lastHeartbeat);
    const approvalPending = Boolean(
      connection.reconnectApprovalTokenHash &&
        connection.reconnectApprovalExpiresAt &&
        !connection.reconnectApprovalUsedAt &&
        connection.reconnectApprovalExpiresAt.getTime() >= Date.now(),
    );
    return {
      _id: String(connection._id),
      clerkUserId: connection.clerkUserId,
      displayName: connection.displayName ?? null,
      facebookUserId: connection.facebookUserId ?? null,
      detectedFacebookUserId: connection.detectedFacebookUserId ?? null,
      status: connection.status,
      workerStatus: connection.workerStatus,
      facebookSessionDetected: connection.facebookSessionDetected ?? false,
      lastSeenAt: connection.lastSeenAt,
      extensionInstanceId: instanceId ?? null,
      extensionInstanceIdMasked: maskExtensionInstanceId(instanceId ?? undefined),
      activeExtensionInstallationId: connection.activeExtensionInstallationId
        ? String(connection.activeExtensionInstallationId)
        : null,
      lifecycle: installation?.status ?? null,
      installationStatus: installation?.status ?? null,
      lastHeartbeat: installation?.lastHeartbeat ?? null,
      isOnline: connectivity.isOnline,
      connectivity: connectivity.connectivity,
      connectivityReason: connectivity.connectivityReason,
      archivedAt: connection.archivedAt ?? null,
      archivedByClerkUserId: connection.archivedByClerkUserId ?? null,
      archiveReason: connection.archiveReason ?? null,
      hasPendingReconnectApproval: approvalPending,
      createdAt: (connection as { createdAt?: Date }).createdAt,
      updatedAt: (connection as { updatedAt?: Date }).updatedAt,
    };
  }

  private sanitizeConnection(
    connection: FacebookConnectionDocument,
  ): Record<string, unknown> {
    const document = connection.toObject ? connection.toObject() : connection;
    const { reconnectApprovalTokenHash, reconnectApprovalUsedAt, ...safe } =
      document as Record<string, unknown> & {
        reconnectApprovalTokenHash?: string;
        reconnectApprovalUsedAt?: Date;
      };
    return { ...safe, _id: String(connection._id) };
  }

  private sanitizeInstallation(
    installation: ExtensionInstallationDocument,
  ): Record<string, unknown> {
    const document = installation.toObject
      ? installation.toObject()
      : installation;
    const { credentialHash, ...safe } = document as Record<string, unknown> & {
      credentialHash?: string;
    };
    return { ...safe, _id: String(installation._id) };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async requireOwnedConnection(clerkUserId: string, connectionId: string) {
    if (!Types.ObjectId.isValid(connectionId)) {
      throw new NotFoundException('Facebook connection not found.');
    }
    const connection = await this.connectionModel
      .findOne({ _id: connectionId, clerkUserId })
      .exec();
    if (!connection) {
      throw new NotFoundException('Facebook connection not found.');
    }
    return connection;
  }

  private async findBoundInstallation(
    connection: FacebookConnectionDocument,
  ): Promise<ExtensionInstallationDocument | null> {
    if (connection.activeExtensionInstallationId) {
      const bound = await this.extensionModel
        .findById(connection.activeExtensionInstallationId)
        .exec();
      if (bound) return bound;
    }
    const candidates = await this.extensionModel
      .find({ facebookConnectionId: connection._id })
      .sort({ statusChangedAt: -1, createdAt: -1 })
      .exec();
    return (
      candidates.find((candidate) => candidate.status !== ExtensionLifecycleStatus.REVOKED) ??
      candidates[0] ??
      null
    );
  }

  private async clearConnectionBindingIfSame(
    connection: FacebookConnectionDocument,
    installation: ExtensionInstallationDocument,
  ) {
    if (
      connection.activeExtensionInstallationId &&
      String(connection.activeExtensionInstallationId) === String(installation._id)
    ) {
      await this.connectionModel.updateOne(
        { _id: connection._id },
        { $unset: { activeExtensionInstallationId: 1 } },
      );
      connection.activeExtensionInstallationId = undefined;
    }
  }

  private async revokeInstallation(
    installation: ExtensionInstallationDocument,
    options: {
      reason: ExtensionRevocationReason;
      byClerkUserId?: string;
      actor: ExtensionLifecycleActor;
    },
  ) {
    const previous = installation.status;
    const now = new Date();
    installation.status = ExtensionLifecycleStatus.REVOKED;
    installation.statusChangedAt = now;
    installation.statusChangedByClerkUserId = options.byClerkUserId;
    installation.statusReason = options.reason;
    installation.revokedAt = now;
    installation.revokedByClerkUserId = options.byClerkUserId;
    installation.revocationReason = options.reason;
    installation.credentialRevokedAt = now;
    installation.credentialVersion = (installation.credentialVersion ?? 0) + 1;
    await installation.save();

    await this.recordAudit(ExtensionLifecycleAuditEventName.INSTALLATION_REVOKED, {
      clerkUserId: installation.clerkUserId,
      installation,
      connectionId: installation.facebookConnectionId,
      actor: options.actor,
      previousLifecycle: previous,
      nextLifecycle: ExtensionLifecycleStatus.REVOKED,
      reason: options.reason,
    });
  }

  /**
   * Finalizes a REVOKE_PENDING installation to REVOKED once no leased work is
   * still in flight. A running publishing job or an unexpired maintenance
   * claim keeps the installation in REVOKE_PENDING so its final result can be
   * reported.
   */
  private async maybeFinalizeRevocation(
    installation: ExtensionInstallationDocument,
  ): Promise<boolean> {
    if (installation.status !== ExtensionLifecycleStatus.REVOKE_PENDING) return false;
    const instanceId = installation.extensionInstanceId;
    if (!instanceId) return false;
    const now = new Date();
    const activeClaim = await this.jobModel
      .findOne({
        $or: [
          {
            claimedByExtensionInstanceId: instanceId,
            status: PublishingJobStatus.RUNNING,
            claimExpiresAt: { $gt: now },
          },
          {
            maintenanceClaimedByExtensionInstanceId: instanceId,
            maintenanceClaimExpiresAt: { $gt: now },
          },
        ],
      })
      .select('_id')
      .lean()
      .exec();
    if (activeClaim) return false;

    const reason = isRevocationReason(installation.statusReason)
      ? installation.statusReason
      : ExtensionRevocationReason.USER_DISCONNECTED;
    await this.revokeInstallation(installation, {
      reason,
      byClerkUserId: installation.statusChangedByClerkUserId,
      actor: ExtensionLifecycleActor.SYSTEM,
    });

    if (installation.facebookConnectionId) {
      await this.connectionModel.updateOne(
        { _id: installation.facebookConnectionId, activeExtensionInstallationId: installation._id },
        { $unset: { activeExtensionInstallationId: 1 } },
      );
    }
    return true;
  }

  private async updateConnectionName(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    extensionName: unknown,
  ) {
    if (extensionName === undefined) return;
    if (typeof extensionName !== 'string') {
      throw new BadRequestException('Extension name must be text.');
    }

    const normalizedName = normalizeExtensionName(extensionName);
    if (normalizedName.length > 60) {
      throw new BadRequestException(
        'Extension name must be 60 characters or fewer.',
      );
    }

    const filter = this.getConnectionFilter(clerkUserId, extensionInstanceId);
    if (!normalizedName) {
      await this.connectionModel
        .findOneAndUpdate(filter, {
          $unset: { displayName: 1, displayNameKey: 1 },
        })
        .exec();
      return;
    }

    const displayNameKey = normalizeExtensionNameKey(normalizedName);
    const current = await this.connectionModel
      .findOne(filter)
      .select('_id')
      .lean()
      .exec();
    if (!current) throw new NotFoundException('Facebook connection not found.');

    const duplicate = await this.connectionModel
      .findOne({
        clerkUserId,
        displayNameKey,
        _id: { $ne: current._id },
      })
      .select('_id')
      .lean()
      .exec();
    if (duplicate) {
      throw new ConflictException('An extension with this name already exists.');
    }

    try {
      await this.connectionModel
        .findOneAndUpdate(filter, {
          $set: { displayName: normalizedName, displayNameKey },
        })
        .exec();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('An extension with this name already exists.');
      }
      throw error;
    }
  }

  async renameConnection(clerkUserId: string, connectionId: string, name: unknown) {
    const connection = await this.requireOwnedConnection(clerkUserId, connectionId);
    if (name === undefined || name === null) {
      throw new BadRequestException('A connection name is required.');
    }
    if (typeof name !== 'string') {
      throw new BadRequestException('Connection name must be text.');
    }
    const normalizedName = normalizeExtensionName(name);
    if (normalizedName.length > 60) {
      throw new BadRequestException(
        'Connection name must be 60 characters or fewer.',
      );
    }
    if (!normalizedName) {
      throw new BadRequestException('Connection name cannot be empty.');
    }

    const displayNameKey = normalizeExtensionNameKey(normalizedName);
    const duplicate = await this.connectionModel
      .findOne({
        clerkUserId,
        displayNameKey,
        _id: { $ne: connection._id },
      })
      .select('_id')
      .lean()
      .exec();
    if (duplicate) {
      throw new ConflictException('An extension with this name already exists.');
    }

    try {
      connection.displayName = normalizedName;
      connection.displayNameKey = displayNameKey;
      await connection.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('An extension with this name already exists.');
      }
      throw error;
    }
    return { displayName: connection.displayName ?? null };
  }
}

export function normalizeExtensionName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function normalizeExtensionNameKey(value: string): string {
  return normalizeExtensionName(value).toLowerCase();
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function mapWorkerStatusToConnectionStatus(
  workerStatus: FacebookConnectionWorkerStatus,
): FacebookConnectionStatus | undefined {
  switch (workerStatus) {
    case FacebookConnectionWorkerStatus.LOGIN_REQUIRED:
      return FacebookConnectionStatus.LOGIN_REQUIRED;
    case FacebookConnectionWorkerStatus.ACCOUNT_MISMATCH:
      return FacebookConnectionStatus.ACCOUNT_MISMATCH;
    case FacebookConnectionWorkerStatus.BLOCKED:
      return FacebookConnectionStatus.BLOCKED;
    case FacebookConnectionWorkerStatus.IDLE:
    case FacebookConnectionWorkerStatus.ONLINE:
    case FacebookConnectionWorkerStatus.PUBLISHING:
      return FacebookConnectionStatus.CONNECTED;
    default:
      return undefined;
  }
}

function buildInstallationMap(
  connections: LeanFacebookConnection[],
  installations: LeanExtensionInstallation[],
): Map<string, LeanExtensionInstallation> {
  const map = new Map<string, LeanExtensionInstallation>();
  for (const installation of installations) {
    map.set(String(installation._id), installation);
  }
  for (const connection of connections) {
    const connectionKey = String(connection._id);
    const best = bestInstallationForConnection(
      installations.filter(
        (installation) =>
          installation.facebookConnectionId &&
          String(installation.facebookConnectionId) === connectionKey,
      ),
    );
    if (best) map.set(connectionKey, best);
  }
  return map;
}

function bestInstallationForConnection<T extends { status?: string | null }>(
  candidates: T[],
): T | undefined {
  if (!candidates.length) return undefined;
  const active = candidates.filter(
    (candidate) =>
      candidate.status !== ExtensionLifecycleStatus.REVOKED,
  );
  return active[0] ?? candidates[0];
}