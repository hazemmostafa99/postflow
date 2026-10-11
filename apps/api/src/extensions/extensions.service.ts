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
import { ClientSession, Model, Types } from 'mongoose';
import { groupBrowserConnections } from './browser-connections';
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
  PlatformConnection,
  PlatformConnectionDocument,
  PlatformConnectionStatus,
  PlatformConnectionWorkerStatus,
} from '../schemas/platform-connection.schema';
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
export type RegistrationOutcome = (
  | { status: 'ACTIVE'; connectionId: string | null; credentialIssued?: string }
  | { status: 'PAUSED'; connectionId: string | null; credentialIssued?: string }
  | { status: 'REVOKE_PENDING'; connectionId: string | null }
  | { status: 'REVOKED'; reason: string }
  | {
      status: 'NEW_INSTALLATION';
      connectionId: string | null;
      credentialIssued: string;
    }
  | {
      status: 'RECOVERY_AVAILABLE';
      candidates: RecoveryCandidate[];
      credentialIssued?: string;
    }) & { installationId?: string; connectionDisplayName?: string | null };

export type ConnectionConnectivity = {
  isOnline: boolean;
  connectivity: 'ONLINE' | 'OFFLINE';
  connectivityReason:
    'HEARTBEAT_RECENT' | 'HEARTBEAT_EXPIRED' | 'HEARTBEAT_MISSING';
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
  ExtensionInstallationDocument | LeanExtensionInstallation;

function isRevocationReason(
  value: unknown,
): value is ExtensionRevocationReason {
  return (
    typeof value === 'string' &&
    Object.values(ExtensionRevocationReason).includes(
      value as ExtensionRevocationReason,
    )
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
    @InjectModel(PlatformConnection.name)
    private readonly platformConnectionModel?: Model<PlatformConnectionDocument>,
  ) {}

  private getInstallationFilter(
    clerkUserId: string,
    extensionInstanceId?: string,
  ) {
    const normalizedInstanceId = extensionInstanceId?.trim();
    return normalizedInstanceId
      ? { clerkUserId, extensionInstanceId: normalizedInstanceId }
      : { clerkUserId };
  }

  private async installationMetadata(installation: ExtensionInstallationDocument) {
    const current = await this.extensionModel.findOne({ _id: installation._id, clerkUserId: installation.clerkUserId }).exec();
    // Do not turn the UI's unnamed fallback into a persisted name on heartbeat.
    return { installationId: String(installation._id), connectionDisplayName: current?.displayName || null };
  }

  private getConnectionFilter(
    clerkUserId: string,
    extensionInstanceId?: string,
  ) {
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
    if (
      !Object.prototype.hasOwnProperty.call(updates, 'facebookSessionDetected')
    ) {
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
      throw new UnauthorizedException(
        'x-extension-instance-id header is required',
      );

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
      throw new ForbiddenException(
        'x-extension-credential header is required.',
      );
    }
    if (
      !verifyInstallationCredential(credential, installation.credentialHash)
    ) {
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
      if (byBinding && !byBinding.removedAt) return byBinding;
    }
    if (installation.extensionInstanceId) {
      return this.connectionModel
        .findOne({
          clerkUserId,
          extensionInstanceId: installation.extensionInstanceId,
          removedAt: null,
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
    const connection = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );
    if (!connection || connection.archivedAt || connection.removedAt) return null;
    if (
      connection.activeExtensionInstallationId &&
      String(connection.activeExtensionInstallationId) !==
        String(installation._id)
    ) {
      return null;
    }
    return connection;
  }

  /**
   * Platform-aware claim gate: resolves the active PlatformConnection for a given platform.
   * Returns null if the installation doesn't own an active, non-archived connection for that platform.
   */
  async resolveActivePlatformConnection(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
    platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK',
    options: { allowPublishing?: boolean } = {},
  ): Promise<PlatformConnectionDocument | null> {
    if (!this.platformConnectionModel) return null;
    const connection = await this.platformConnectionModel
      .findOne({
        clerkUserId,
        platform: platform as any,
        activeExtensionInstallationId: installation._id,
        archivedAt: null,
        removedAt: null,
      })
      .exec();
    if (!connection) return null;
    // Verify the connection status allows claiming work
    if (
      connection.status !== PlatformConnectionStatus.CONNECTED ||
      (!options.allowPublishing &&
        connection.workerStatus === PlatformConnectionWorkerStatus.PUBLISHING)
    ) {
      return null;
    }
    return connection;
  }

  /**
   * Get the platform connection for a specific platform connection ID, verifying ownership.
   */
  async getPlatformConnectionById(
    clerkUserId: string,
    platformConnectionId: string,
  ): Promise<PlatformConnectionDocument | null> {
    if (!this.platformConnectionModel) return null;
    return this.platformConnectionModel
      .findOne({ _id: platformConnectionId, clerkUserId })
      .exec();
  }

  async listBrowserConnections(clerkUserId: string) {
    const [installations, facebook, archivedFacebook, platforms] = await Promise.all([
      this.listInstallations(clerkUserId),
      this.listConnections(clerkUserId),
      this.listArchivedConnections(clerkUserId),
      this.listPlatformConnections(clerkUserId),
    ]);
    return groupBrowserConnections(installations, [...facebook, ...archivedFacebook], platforms, true);
  }

  async updateBrowserConnection(clerkUserId: string, installationId: string, name: unknown) {
    if (typeof name !== 'string' || !normalizeExtensionName(name) || normalizeExtensionName(name).length > 60) {
      throw new BadRequestException('Enter a connection name between 1 and 60 characters.');
    }
    if (!Types.ObjectId.isValid(installationId)) throw new BadRequestException('Invalid installation id.');
    const installation = await this.extensionModel.findOne({ _id: installationId, clerkUserId }).exec();
    if (!installation) throw new NotFoundException('Browser connection not found.');
    if (installation.archivedAt || [ExtensionLifecycleStatus.REVOKED, ExtensionLifecycleStatus.REVOKE_PENDING].includes(installation.status)) {
      throw new ConflictException('This connection is disconnecting or disconnected.');
    }
    // Keep the legacy durable recovery label synchronized when Facebook is bound.
    if (installation.facebookConnectionId) {
      await this.renameConnection(clerkUserId, String(installation.facebookConnectionId), name);
    }
    installation.displayName = normalizeExtensionName(name);
    installation.displayNameKey = normalizeExtensionNameKey(name);
    await installation.save();
    return { displayName: installation.displayName };
  }

  async browserConnectionAction(clerkUserId: string, installationId: string, action: string) {
    if (!['pause', 'resume', 'disconnect', 'force-disconnect', 'remove', 'restore-approval'].includes(action)) throw new BadRequestException('Invalid browser action.');
    if (!Types.ObjectId.isValid(installationId)) throw new BadRequestException('Invalid installation id.');
    if (action === 'restore-approval') return this.issueDisconnectedRestoreApproval(clerkUserId, installationId);
    const installation = await this.extensionModel.findOne({ _id: installationId, clerkUserId }).exec();
    if (!installation) throw new NotFoundException('Browser connection not found.');
    if (action === 'force-disconnect' || action === 'remove') {
      return this.revokeBrowserConnection(clerkUserId, installation, action === 'remove');
    }
    if (installation.archivedAt || installation.status === ExtensionLifecycleStatus.REVOKED || installation.status === ExtensionLifecycleStatus.REVOKE_PENDING) {
      throw new ConflictException('This browser connection is disconnecting or disconnected.');
    }
    const previous = installation.status;
    const nextStatus = action === 'pause' ? ExtensionLifecycleStatus.PAUSED : action === 'resume'
      ? ExtensionLifecycleStatus.ACTIVE : ExtensionLifecycleStatus.REVOKE_PENDING;
    // A stale Pause/Resume must never undo a disconnect from another dashboard.
    const updated = await this.extensionModel.findOneAndUpdate({
      _id: installationId, clerkUserId, status: previous,
    }, {
      $set: {
        status: nextStatus, statusChangedAt: new Date(), statusChangedByClerkUserId: clerkUserId,
        ...(action === 'disconnect' ? { statusReason: ExtensionRevocationReason.USER_DISCONNECTED } : {}),
      },
      ...(action !== 'disconnect' ? { $unset: { statusReason: 1 } } : {}),
    }, { returnDocument: 'after' }).exec();
    if (!updated) throw new ConflictException('Browser connection changed. Refresh and try again.');
    await this.recordAudit(action === 'pause' ? ExtensionLifecycleAuditEventName.INSTALLATION_PAUSED
      : action === 'resume' ? ExtensionLifecycleAuditEventName.INSTALLATION_RESUMED : ExtensionLifecycleAuditEventName.DISCONNECT_REQUESTED, {
      clerkUserId, installation: updated, connectionId: updated.facebookConnectionId,
      actor: ExtensionLifecycleActor.DASHBOARD, previousLifecycle: previous, nextLifecycle: updated.status,
    });
    if (action === 'disconnect') await this.maybeFinalizeRevocation(updated);
    return { status: updated.status };
  }

  async issueDisconnectedRestoreApproval(clerkUserId: string, installationId: string) {
    if (!Types.ObjectId.isValid(installationId)) throw new BadRequestException('Invalid installation id.');
    const token = generateInstallationCredential();
    const expiresAt = new Date(Date.now() + RECONNECT_APPROVAL_TTL_MS);
    const installation = await this.extensionModel.findOneAndUpdate({
      _id: installationId,
      clerkUserId,
      status: ExtensionLifecycleStatus.REVOKED,
      revocationReason: ExtensionRevocationReason.USER_DISCONNECTED,
      removedAt: null,
      archivedAt: null,
    }, {
      $set: {
        restoreApprovalTokenHash: hashInstallationCredential(token),
        restoreApprovalExpiresAt: expiresAt,
      },
    }, { returnDocument: 'after' }).exec();
    if (!installation) throw new ConflictException('Only a disconnected, non-removed installation can be restored.');
    return { installationId: String(installation._id), approvalToken: token, expiresAt };
  }

  async restoreDisconnectedInstallation(clerkUserId: string, extensionInstanceId: string | undefined, approvalToken: string | undefined) {
    const instanceId = extensionInstanceId?.trim();
    if (!instanceId || !approvalToken) throw new BadRequestException('Installation identity and restore approval are required.');
    const installation = await this.extensionModel.findOne({ clerkUserId, extensionInstanceId: instanceId }).exec();
    if (!installation || installation.status !== ExtensionLifecycleStatus.REVOKED ||
      installation.revocationReason !== ExtensionRevocationReason.USER_DISCONNECTED ||
      installation.removedAt || installation.archivedAt ||
      !installation.restoreApprovalTokenHash || !installation.restoreApprovalExpiresAt ||
      installation.restoreApprovalExpiresAt.getTime() <= Date.now() ||
      !verifyInstallationCredential(approvalToken, installation.restoreApprovalTokenHash)) {
      throw new ForbiddenException('This disconnected installation cannot be restored with this approval.');
    }
    if (installation.facebookConnectionId) {
      const facebook = await this.connectionModel.findOne({ _id: installation.facebookConnectionId, clerkUserId }).exec();
      if (facebook?.activeExtensionInstallationId &&
        String(facebook.activeExtensionInstallationId) !== String(installation._id)) {
        throw new ConflictException('The Facebook connection belongs to another installation.');
      }
    }
    const credential = generateInstallationCredential();
    const restored = await this.extensionModel.findOneAndUpdate({
      _id: installation._id,
      clerkUserId,
      status: ExtensionLifecycleStatus.REVOKED,
      revocationReason: ExtensionRevocationReason.USER_DISCONNECTED,
      removedAt: null,
      archivedAt: null,
      restoreApprovalTokenHash: installation.restoreApprovalTokenHash,
      restoreApprovalExpiresAt: { $gt: new Date() },
    }, {
      $set: {
        status: ExtensionLifecycleStatus.ACTIVE,
        statusChangedAt: new Date(),
        statusChangedByClerkUserId: clerkUserId,
        credentialHash: hashInstallationCredential(credential),
        credentialIssuedAt: new Date(),
        facebookSessionDetected: false,
      },
      $inc: { credentialVersion: 1 },
      $unset: {
        statusReason: 1, revokedAt: 1, revokedByClerkUserId: 1,
        revocationReason: 1, credentialRevokedAt: 1,
        restoreApprovalTokenHash: 1, restoreApprovalExpiresAt: 1,
      },
    }, { returnDocument: 'after' }).exec();
    if (!restored) throw new ConflictException('Restore approval was already used or the installation changed.');
    await this.recordAudit(ExtensionLifecycleAuditEventName.INSTALLATION_RESTORED, {
      clerkUserId, installation: restored, connectionId: restored.facebookConnectionId,
      actor: ExtensionLifecycleActor.DASHBOARD, previousLifecycle: ExtensionLifecycleStatus.REVOKED,
      nextLifecycle: ExtensionLifecycleStatus.ACTIVE,
    });
    return { status: 'ACTIVE', credentialIssued: credential, installationId: String(restored._id) };
  }

  /** Atomically revoke this installation, never a Facebook account's newer binding. */
  private async revokeBrowserConnection(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
    remove: boolean,
  ) {
    const previous = installation.status;
    const revoke = previous !== ExtensionLifecycleStatus.REVOKED;
    const removeNow = remove && !installation.removedAt;
    if (!revoke && !removeNow) {
      if (remove) await this.markBrowserAccountsRemoved(clerkUserId, installation, installation.removedAt!);
      return remove
        ? { status: installation.status, removed: Boolean(installation.removedAt) }
        : { status: installation.status, archivedAt: installation.archivedAt ?? null };
    }
    const now = new Date();
    const reason = remove ? ExtensionRevocationReason.REMOVED : ExtensionRevocationReason.USER_DISCONNECTED;
    const updated = await this.extensionModel.findOneAndUpdate({
      _id: installation._id, clerkUserId, status: previous,
      removedAt: installation.removedAt ?? null,
    }, {
      $set: {
        ...(revoke ? {
          status: ExtensionLifecycleStatus.REVOKED, statusChangedAt: now,
          statusChangedByClerkUserId: clerkUserId, statusReason: reason,
          revokedAt: now, revokedByClerkUserId: clerkUserId, revocationReason: reason,
          credentialRevokedAt: now,
        } : {}),
        ...(removeNow ? { removedAt: now } : {}),
      },
      ...(revoke ? { $inc: { credentialVersion: 1 } } : {}),
    }, { returnDocument: 'after' }).exec();
    if (!updated) throw new ConflictException('Connection changed. Refresh and try again.');
    if (revoke) await this.recordAudit(ExtensionLifecycleAuditEventName.INSTALLATION_REVOKED, {
      clerkUserId, installation: updated, connectionId: updated.facebookConnectionId,
      actor: ExtensionLifecycleActor.DASHBOARD, previousLifecycle: previous,
      nextLifecycle: ExtensionLifecycleStatus.REVOKED, reason,
    });
    if (removeNow) {
      await this.markBrowserAccountsRemoved(clerkUserId, updated, now);
      await this.recordAudit(ExtensionLifecycleAuditEventName.CONNECTION_REMOVED, {
        clerkUserId, installation: updated, connectionId: updated.facebookConnectionId,
        actor: ExtensionLifecycleActor.DASHBOARD, reason,
      });
    }
    // Keep account IDs as historical evidence. The revoked instance cannot
    // register again; a newly verified installation may reattach an account.
    return remove
      ? { status: updated.status, removed: Boolean(updated.removedAt) }
      : { status: updated.status, archivedAt: updated.archivedAt ?? null };
  }

  private async markBrowserAccountsRemoved(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
    removedAt: Date,
  ) {
    if (installation.facebookConnectionId) await this.connectionModel.updateOne({
      _id: installation.facebookConnectionId,
      clerkUserId,
      removedAt: null,
      $or: [
        { activeExtensionInstallationId: installation._id },
        { activeExtensionInstallationId: null },
      ],
    }, {
      $set: { removedAt, status: FacebookConnectionStatus.DISCONNECTED,
        workerStatus: FacebookConnectionWorkerStatus.OFFLINE, facebookSessionDetected: false },
      $unset: { displayNameKey: 1 },
    });
    if (this.platformConnectionModel) await this.platformConnectionModel.updateMany({
      clerkUserId, activeExtensionInstallationId: installation._id, removedAt: null,
    }, {
      $set: { removedAt, status: PlatformConnectionStatus.DISCONNECTED,
        workerStatus: PlatformConnectionWorkerStatus.OFFLINE, sessionDetected: false },
      $unset: { displayNameKey: 1 },
    });
  }

  async listInstallations(clerkUserId: string) {
    const installations = await this.extensionModel
      .find({ clerkUserId, removedAt: null })
      .sort({ lastHeartbeat: -1, createdAt: -1 })
      .lean()
      .exec();
    return (installations as unknown as Array<Record<string, unknown>>).map((installation) => ({
      _id: String(installation._id),
      displayName: installation.displayName ?? null,
      archivedAt: installation.archivedAt ?? null,
      archivedByClerkUserId: installation.archivedByClerkUserId ?? null,
      archiveReason: installation.archiveReason ?? null,
      facebookConnectionId: installation.facebookConnectionId ?? null,
      extensionInstanceId: installation.extensionInstanceId ?? null,
      status: installation.status ?? null,
      revocationReason: installation.revocationReason ?? null,
      lastHeartbeat: installation.lastHeartbeat ?? null,
      facebookSessionDetected: installation.facebookSessionDetected ?? false,
    }));
  }

  /**
   * Manual/recovery binding for a new platform connection. Normal first-time
   * Instagram/TikTok setup is handled by the verified session report below.
   */
  async createPlatformConnection(
    clerkUserId: string,
    options: {
      platform?: 'INSTAGRAM' | 'TIKTOK';
      installationId?: string;
      displayName?: string;
      externalAccountId?: string;
      externalUsername?: string;
    },
  ) {
    if (!this.platformConnectionModel) {
      throw new NotFoundException('Platform connections are not enabled');
    }
    if (!options.platform || !['INSTAGRAM', 'TIKTOK'].includes(options.platform)) {
      throw new BadRequestException(
        'Only Instagram and TikTok connections are supported.',
      );
    }
    const platform = options.platform;
    const platformName = platform === 'INSTAGRAM' ? 'Instagram' : 'TikTok';
    if (!options.installationId || !Types.ObjectId.isValid(options.installationId)) {
      throw new BadRequestException('A valid extension installation is required.');
    }
    const installation = await this.extensionModel
      .findOne({
        _id: options.installationId,
        clerkUserId,
      })
      .exec();
    if (!installation) {
      throw new NotFoundException('Extension installation not found.');
    }
    if (installation.status !== ExtensionLifecycleStatus.ACTIVE) {
      throw new ForbiddenException('The selected extension installation is not active.');
    }

    const displayName = normalizeExtensionName(options.displayName ?? '');
    if (!displayName || displayName.length > 60) {
      throw new BadRequestException(
        'A connection name between 1 and 60 characters is required.',
      );
    }
    const externalAccountId = options.externalAccountId?.trim() || undefined;
    if (platform === 'INSTAGRAM' && externalAccountId && !/^\d+$/.test(externalAccountId)) {
      throw new BadRequestException('A valid Instagram account ID is required.');
    }
    const externalUsername = normalizePlatformUsername(options.externalUsername);
    if (!externalAccountId && !externalUsername) {
      throw new BadRequestException(`A valid ${platformName} account identity is required.`);
    }

    const activeBinding = await this.platformConnectionModel
      .findOne({
        clerkUserId,
        platform: platform as any,
        activeExtensionInstallationId: installation._id,
        archivedAt: null,
        removedAt: null,
      })
      .exec();
    if (activeBinding) {
      throw new ConflictException(
        `This extension installation already has a ${platformName} connection.`,
      );
    }
    const duplicateAccount = await this.platformConnectionModel
      .findOne({
        clerkUserId,
        platform: platform as any,
        ...(externalAccountId ? { externalAccountId } : { externalUsername }),
        archivedAt: null,
      })
      .exec();
    if (duplicateAccount) {
      throw new ConflictException(
        `This ${platformName} account is already connected to PostFlow.`,
      );
    }

    const created = (await this.platformConnectionModel.create({
      clerkUserId,
      platform: platform as any,
      activeExtensionInstallationId: installation._id,
      displayName,
      displayNameKey: normalizeExtensionNameKey(displayName),
      ...(externalAccountId ? { externalAccountId } : { externalUsername }),
      status: PlatformConnectionStatus.PENDING,
      workerStatus: PlatformConnectionWorkerStatus.OFFLINE,
      sessionDetected: false,
      lastSeenAt: new Date(),
    })) as PlatformConnectionDocument;
    return sanitizePlatformConnection(created);
  }

  /**
   * Update platform connection worker status by connection ID.
   */
  async updatePlatformConnectionWorkerStatusById(
    platformConnectionId: string,
    workerStatus: PlatformConnectionWorkerStatus,
    reason?: string,
  ): Promise<PlatformConnectionDocument | null> {
    if (!this.platformConnectionModel) return null;
    return this.platformConnectionModel
      .findByIdAndUpdate(
        platformConnectionId,
        {
          $set: {
            workerStatus,
            ...(reason ? { statusReason: reason.slice(0, 500) } : {}),
            lastSeenAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
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
    const connection = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );
    if (!connection) return null;
    // A removed connection must never be refreshed back onto the dashboard.
    if (connection.archivedAt || connection.removedAt) return connection;
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
    session?: ClientSession,
  ) {
    try {
      const audit = {
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
      };
      if (session) {
        await this.auditModel.create([audit], { session });
      } else {
        await this.auditModel.create(audit);
      }
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
      throw new UnauthorizedException(
        'x-extension-instance-id header is required',
      );

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
        ...(await this.installationMetadata(installation)),
        connectionId,
        ...(credentialIssued ? { credentialIssued } : {}),
      };
    }
    if (installation.status === ExtensionLifecycleStatus.REVOKE_PENDING) {
      return { status: 'REVOKE_PENDING', connectionId, ...(await this.installationMetadata(installation)) };
    }

    // An unbound installation whose Facebook identity was already verified
    // re-reports its recovery candidates on every register — for example when
    // the service worker restarts before the user has chosen to reconnect or
    // create a new connection. Identity never auto-binds; the candidates are
    // suggestions only.
    if (
      !connectionId &&
      installation.facebookSessionDetected &&
      installation.detectedFacebookUserId
    ) {
      const candidates = await this.findRecoveryCandidates(
        clerkUserId,
        installation,
        installation.detectedFacebookUserId,
      );
      if (candidates.length > 0) {
        return {
          status: 'RECOVERY_AVAILABLE',
          ...(await this.installationMetadata(installation)),
          candidates,
          ...(credentialIssued ? { credentialIssued } : {}),
        };
      }
    }

    return {
      status: 'ACTIVE',
      ...(await this.installationMetadata(installation)),
      connectionId,
      ...(credentialIssued ? { credentialIssued } : {}),
    };
  }

  /**
   * A reinstall registers as a NEW, UNBOUND installation: no Facebook
   * connection is created or inherited here. The connection is created later
   * either by the new-connection flow (first verified session with no
   * recovery candidates) or by an explicit reconnect the user chooses.
   */
  private async registerNewInstallation(
    clerkUserId: string,
    extensionInstanceId: string,
    extensionName?: unknown,
  ): Promise<RegistrationOutcome> {
    const now = new Date();
    const credential = generateInstallationCredential();
    const installation = await this.extensionModel.create({
      clerkUserId,
      extensionInstanceId,
      status: ExtensionLifecycleStatus.ACTIVE,
      statusChangedAt: now,
      lastHeartbeat: now,
      facebookSessionDetected: false,
      credentialHash: hashInstallationCredential(credential),
      credentialVersion: 1,
      credentialIssuedAt: now,
    });

    // Store the shared name on the installation, without requiring Facebook.
    await this.updateConnectionName(
      clerkUserId,
      extensionInstanceId,
      extensionName,
    );

    await this.recordAudit(
      ExtensionLifecycleAuditEventName.INSTALLATION_REGISTERED,
      {
        clerkUserId,
        installation,
        actor: ExtensionLifecycleActor.WORKER,
        previousLifecycle: undefined,
        nextLifecycle: ExtensionLifecycleStatus.ACTIVE,
      },
    );

    return {
      status: 'NEW_INSTALLATION',
      ...(await this.installationMetadata(installation)),
      connectionId: null,
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
      installation.credentialVersion =
        (installation.credentialVersion ?? 0) + 1;
      installation.credentialIssuedAt = new Date();
      credentialIssued = credential;
    }

    const connection = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );
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
    }
    // No connection → the installation stays UNBOUND on purpose. Connections
    // are only ever created by the new-connection flow (verified session with
    // no recovery candidates) or an explicit reconnect.

    await this.updateConnectionName(
      clerkUserId,
      normalizedInstanceId,
      extensionName,
    );
    await installation.save();

    return {
      connectionId: connection?._id ? String(connection._id) : null,
      ...(credentialIssued ? { credentialIssued } : {}),
    };
  }

  private nextHeartbeatWorkerStatus(
    existing: FacebookConnectionWorkerStatus | undefined,
  ): FacebookConnectionWorkerStatus {
    if (existing && PERSISTENT_HEARTBEAT_STATUSES.has(existing))
      return existing;
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
      throw new UnauthorizedException(
        'x-extension-instance-id header is required',
      );

    installation.lastHeartbeat = new Date();
    const existingConnection = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );
    const connection = await this.updateConnectionForWorker(
      clerkUserId,
      installation,
      {
        workerStatus: this.nextHeartbeatWorkerStatus(
          existingConnection?.workerStatus,
        ),
      },
    );
    if (connection) {
      installation.facebookConnectionId = connection._id;
    }
    await this.updateConnectionName(
      clerkUserId,
      normalizedInstanceId,
      extensionName,
    );
    await installation.save();
    await this.maybeFinalizeRevocation(installation);

    return {
      status: installation.status,
      ...(await this.installationMetadata(installation)),
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
    if (
      !Object.values(FacebookConnectionWorkerStatus).includes(
        workerStatus as FacebookConnectionWorkerStatus,
      )
    ) {
      throw new BadRequestException('Invalid extension worker status');
    }
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const connectionStatus = mapWorkerStatusToConnectionStatus(workerStatus!);
    const connection = await this.updateConnectionForWorker(
      clerkUserId,
      installation,
      {
        workerStatus,
        ...(connectionStatus ? { status: connectionStatus } : {}),
        ...(reason ? { statusReason: reason.slice(0, 500) } : {}),
      },
    );
    if (!connection) {
      // An unbound installation has no connection to report status on yet.
      // Status becomes applicable once the new-connection or recovery flow
      // completes; this is not an error.
      return null;
    }
    return this.sanitizeConnection(connection);
  }

  /**
   * Update platform connection worker status (for Instagram, TikTok, etc.)
   */
  async updatePlatformConnectionWorkerStatus(
    platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK',
    clerkUserId: string,
    extensionInstanceId?: string,
    credential?: string,
    workerStatus?: PlatformConnectionWorkerStatus,
    reason?: string,
  ) {
    if (!this.platformConnectionModel) {
      throw new NotFoundException('Platform connections are not enabled');
    }
    if (
      !Object.values(PlatformConnectionWorkerStatus).includes(
        workerStatus as PlatformConnectionWorkerStatus,
      )
    ) {
      throw new BadRequestException('Invalid platform worker status');
    }
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );

    // Find the platform connection for this installation
    const platformConnection = await this.platformConnectionModel
      .findOne({
        activeExtensionInstallationId: installation._id,
        platform: platform as any,
        archivedAt: null,
        removedAt: null,
      })
      .exec();

    if (!platformConnection) {
      // An unbound installation has no platform connection to report status on yet.
      return null;
    }

    const connectionStatus = mapPlatformWorkerStatusToConnectionStatus(workerStatus!);
    platformConnection.workerStatus = workerStatus!;
    if (connectionStatus) {
      platformConnection.status = connectionStatus;
    }
    if (reason) {
      platformConnection.statusReason = reason.slice(0, 500);
    }
    platformConnection.lastSeenAt = new Date();
    await platformConnection.save();

    return sanitizePlatformConnection(platformConnection);
  }

  /**
   * Update one platform's detected session identity. A platform's first
   * verified session follows the same hands-off flow as Facebook: when this
   * installation has no connection yet, create a new connection from the
   * detected platform account identity. Live and archived connections are not
   * rebound automatically; an explicitly removed account may be reattached
   * after a new installation reports the same verified identity.
   */
  async updatePlatformSession(
    platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK',
    clerkUserId: string,
    extensionInstanceId?: string,
    credential?: string,
    sessionDetected?: boolean,
    detectedExternalAccountId?: string,
    detectedExternalUsername?: string,
    evidence?: { state: 'VERIFIED' | 'CHECKING' | 'LOGIN_REQUIRED' | 'STALE'; source?: string },
  ) {
    if (!['FACEBOOK', 'INSTAGRAM', 'TIKTOK'].includes(platform)) {
      throw new BadRequestException('Invalid publishing platform');
    }
    if (evidence && (platform !== 'INSTAGRAM' || !['VERIFIED', 'CHECKING', 'LOGIN_REQUIRED', 'STALE'].includes(evidence.state))) {
      throw new BadRequestException('Invalid platform session evidence');
    }
    if (evidence?.state === 'VERIFIED' && (!sessionDetected || (!detectedExternalAccountId?.trim() && !detectedExternalUsername?.trim()))) {
      throw new BadRequestException('Verified Instagram evidence requires an account identity');
    }
    if (evidence?.state === 'LOGIN_REQUIRED') sessionDetected = false;
    if (!this.platformConnectionModel) {
      throw new NotFoundException('Platform connections are not enabled');
    }
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const platformConnection = (await this.platformConnectionModel
      .findOne({
        clerkUserId,
        platform: platform as any,
        activeExtensionInstallationId: installation._id,
        archivedAt: null,
        removedAt: null,
      })
      .exec()) as PlatformConnectionDocument | null;

    const normalizedAccountId = detectedExternalAccountId?.trim() || undefined;
    if (platform === 'INSTAGRAM' && normalizedAccountId && !/^\d+$/.test(normalizedAccountId)) {
      throw new BadRequestException('Invalid Instagram account ID');
    }
    const normalizedUsername = normalizePlatformUsername(detectedExternalUsername);
    // Loading/unknown is not a logout. Legacy Instagram false reports also
    // remain non-destructive until the worker sends explicit login evidence.
    const checking = platform === 'INSTAGRAM' && (evidence?.state === 'CHECKING' || (!evidence && !sessionDetected));
    if (checking || evidence?.state === 'STALE') {
      if (!platformConnection) return null;
      platformConnection.sessionEvidenceState = evidence?.state ?? 'CHECKING';
      // CHECKING/STALE means the document is unavailable or the cached proof
      // expired. It is not logout evidence. Keep the installation-bound
      // account connected until the page explicitly reports LOGIN_REQUIRED or
      // ACCOUNT_MISMATCH, then refresh it before publishing.
      platformConnection.lastSeenAt = new Date();
      await platformConnection.save();
      return sanitizePlatformConnection(platformConnection);
    }
    this.logger.log(
      `[${platform}] session report: detected=${Boolean(sessionDetected)} accountId=${normalizedAccountId ?? 'none'} installation=${maskExtensionInstanceId(installation.extensionInstanceId)}`,
    );

    if (!platformConnection) {
      try {
        return await this.autoConnectPlatformSession(
          clerkUserId,
          platform,
          installation,
          Boolean(sessionDetected),
          normalizedAccountId,
          normalizedUsername,
        );
      } catch (error) {
        // Keep the worker response actionable. A Mongo/index failure here used
        // to surface as an opaque HTTP 500, which made a valid TikTok session
        // look like a logout in the extension.
        this.logger.error(
          `[${platform}] automatic session binding failed for installation ${maskExtensionInstanceId(installation.extensionInstanceId)}`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }
    }

    const expectedAccountId = platformConnection.externalAccountId?.trim();
    const expectedUsername = platformConnection.externalUsername?.trim();
    const identityMismatch = Boolean(
      sessionDetected && (
        Boolean(expectedAccountId &&
          (!normalizedAccountId || expectedAccountId !== normalizedAccountId)) ||
        Boolean(!expectedAccountId && expectedUsername && !normalizedAccountId &&
          (!normalizedUsername || expectedUsername.toLowerCase() !== normalizedUsername.toLowerCase()))
      ),
    );

    const persistentStatuses = new Set([
      PlatformConnectionWorkerStatus.PUBLISHING,
      PlatformConnectionWorkerStatus.BLOCKED,
      PlatformConnectionWorkerStatus.CHECKPOINT_OR_VERIFICATION,
      PlatformConnectionWorkerStatus.CAPTCHA_OR_CHALLENGE,
      PlatformConnectionWorkerStatus.MANUAL_INTERVENTION_REQUIRED,
    ]);
    platformConnection.sessionDetected = Boolean(sessionDetected);
    if (platform === 'INSTAGRAM') {
      platformConnection.sessionEvidenceState = evidence?.state ?? (sessionDetected ? 'VERIFIED' : 'LOGIN_REQUIRED');
      platformConnection.sessionEvidenceSource = evidence?.source;
      if (sessionDetected) platformConnection.sessionVerifiedAt = new Date();
    }
    platformConnection.status = !sessionDetected
      ? PlatformConnectionStatus.LOGIN_REQUIRED
      : identityMismatch
        ? PlatformConnectionStatus.ACCOUNT_MISMATCH
        : PlatformConnectionStatus.CONNECTED;
    platformConnection.workerStatus = !sessionDetected
      ? PlatformConnectionWorkerStatus.LOGIN_REQUIRED
      : identityMismatch
        ? PlatformConnectionWorkerStatus.ACCOUNT_MISMATCH
        : persistentStatuses.has(platformConnection.workerStatus)
          ? platformConnection.workerStatus
          : PlatformConnectionWorkerStatus.IDLE;
    platformConnection.statusReason = identityMismatch
      ? 'Detected platform identity does not match the expected connection.'
      : undefined;
    if (normalizedAccountId) {
      platformConnection.detectedExternalAccountId = normalizedAccountId;
    }
    // Instagram identity is intentionally ID-only. Do not persist or refresh
    // a username when the stable ds_user_id is available.
    if (platform === 'INSTAGRAM' && normalizedAccountId) {
      platformConnection.externalUsername = undefined;
      platformConnection.detectedExternalUsername = undefined;
    } else if (normalizedUsername) {
      platformConnection.detectedExternalUsername = normalizedUsername;
    }
    platformConnection.lastSeenAt = new Date();
    await platformConnection.save();

    return sanitizePlatformConnection(platformConnection);
  }

  private async autoConnectPlatformSession(
    clerkUserId: string,
    platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK',
    installation: ExtensionInstallationDocument,
    sessionDetected: boolean,
    externalAccountId?: string,
    externalUsername?: string,
  ): Promise<Record<string, unknown> | null> {
    installation.lastHeartbeat = new Date();

    if (!sessionDetected || (!externalAccountId && !externalUsername)) {
      this.logger.log(
        `[${platform}] no automatic connection: session or account identity was not detected`,
      );
      await installation.save();
      return null;
    }

    // Live or archived accounts on another installation need explicit recovery.
    // An account removed by the owner may reattach after verified session proof.
    const accountIdentity = externalAccountId
      ? { externalAccountId }
      : { externalUsername };
    // Include archived records in this lookup. The account/display-name
    // indexes intentionally remain unique across the user's history, so an
    // archived connection must not cause a second automatic create (and a
    // Mongo duplicate-key 500) during a fresh extension install.
    const existingAccount = await this.platformConnectionModel!.findOne({
      clerkUserId,
      platform: platform as any,
      ...accountIdentity,
    }).exec() as PlatformConnectionDocument | null;
    if (existingAccount?.removedAt) {
      const restored = await this.platformConnectionModel!.findOneAndUpdate({
        _id: existingAccount._id, clerkUserId, removedAt: existingAccount.removedAt,
      }, {
        $set: { activeExtensionInstallationId: installation._id,
          status: PlatformConnectionStatus.CONNECTED, workerStatus: PlatformConnectionWorkerStatus.IDLE,
          sessionDetected: true, lastSeenAt: new Date(),
          ...(platform === 'INSTAGRAM' ? { sessionEvidenceState: 'VERIFIED', sessionVerifiedAt: new Date() } : {}) },
        $unset: { removedAt: 1, archivedAt: 1, archivedByClerkUserId: 1, archiveReason: 1, statusReason: 1 },
      }, { returnDocument: 'after' }).exec() as PlatformConnectionDocument | null;
      if (restored) {
        await installation.save();
        return sanitizePlatformConnection(restored);
      }
    }
    if (existingAccount?.archivedAt &&
      String(existingAccount.activeExtensionInstallationId ?? '') === String(installation._id)) {
      const restored = await this.platformConnectionModel!.findOneAndUpdate({
        _id: existingAccount._id, clerkUserId,
        activeExtensionInstallationId: installation._id,
        archivedAt: existingAccount.archivedAt,
        removedAt: null,
      }, {
        $set: { status: PlatformConnectionStatus.CONNECTED,
          workerStatus: PlatformConnectionWorkerStatus.IDLE,
          sessionDetected: true, lastSeenAt: new Date(),
          ...(platform === 'INSTAGRAM' ? { sessionEvidenceState: 'VERIFIED', sessionVerifiedAt: new Date() } : {}) },
        $unset: { archivedAt: 1, archivedByClerkUserId: 1, archiveReason: 1, statusReason: 1 },
      }, { returnDocument: 'after' }).exec() as PlatformConnectionDocument | null;
      if (restored) {
        await installation.save();
        return sanitizePlatformConnection(restored);
      }
    }
    if (existingAccount) {
      const ownerInstallation = existingAccount.activeExtensionInstallationId
        ? await this.extensionModel.findById(existingAccount.activeExtensionInstallationId).exec()
        : null;
      throw new ConflictException(ownerInstallation?.status === ExtensionLifecycleStatus.REVOKED
        ? `This ${platform.toLowerCase()} account belongs to another disconnected extension connection. Restore or remove that connection first.`
        : `This ${platform.toLowerCase()} account is already linked to another connection. Open that connection or remove it before connecting this extension.`);
    }

    const platformName = platform === 'INSTAGRAM'
      ? 'Instagram'
      : platform === 'TIKTOK'
        ? 'TikTok'
        : platform;
    const displayName = externalAccountId && platform === 'INSTAGRAM'
      ? 'Instagram account'
      : `${platformName} @${externalUsername}`
      .slice(0, 60);
    let connection: PlatformConnectionDocument;
    try {
      connection = (await this.platformConnectionModel!.create({
        clerkUserId,
        platform: platform as any,
        activeExtensionInstallationId: installation._id,
        displayName,
        displayNameKey: normalizeExtensionNameKey(displayName),
        ...(externalAccountId ? { externalAccountId, detectedExternalAccountId: externalAccountId } : {}),
        ...(externalUsername && !externalAccountId ? { externalUsername, detectedExternalUsername: externalUsername } : {}),
        status: PlatformConnectionStatus.CONNECTED,
        workerStatus: PlatformConnectionWorkerStatus.IDLE,
        sessionDetected: true,
        lastSeenAt: new Date(),
        ...(platform === 'INSTAGRAM' ? { sessionEvidenceState: 'VERIFIED', sessionVerifiedAt: new Date() } : {}),
      })) as PlatformConnectionDocument;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      // Two startup probes can report the same session concurrently. Recover
      // the connection created by the winner instead of turning that normal
      // race into a 500.
      const winner = await this.platformConnectionModel!.findOne({
        clerkUserId,
        platform: platform as any,
        activeExtensionInstallationId: installation._id,
        archivedAt: null,
      }).exec() as PlatformConnectionDocument | null;
      if (winner) {
        await installation.save();
        this.logger.warn(`[${platform}] automatic connection race recovered`);
        return sanitizePlatformConnection(winner);
      }

      // A historical/other-installation account owns the unique key. Keep the
      // explicit reconnect boundary and return a normal no-op outcome.
      const owner = await this.platformConnectionModel!.findOne({
        clerkUserId,
        platform: platform as any,
        ...accountIdentity,
      }).exec() as PlatformConnectionDocument | null;
      if (owner) {
        throw new ConflictException(
          `This ${platform.toLowerCase()} account is already linked to another connection. Open that connection or remove it before connecting this extension.`,
        );
      }
      throw new ConflictException(
        `The ${platform.toLowerCase()} account is already linked to another connection.`,
      );
    }

    await installation.save();
    this.logger.log(
      `[${platform}] automatic connection created for account ${externalAccountId ?? 'legacy username'}`,
    );
    return sanitizePlatformConnection(connection);
  }

  async updateSession(
    clerkUserId: string,
    extensionInstanceId?: string,
    credential?: string,
    sessionDetected?: boolean,
    detectedFacebookUserId?: string,
  ): Promise<{
    installation: Record<string, unknown>;
    connection: Record<string, unknown> | null;
    recoveryCandidates: RecoveryCandidate[];
  }> {
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const normalizedFacebookUserId =
      detectedFacebookUserId?.trim() || undefined;
    const existingConnection = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );

    // A new (reinstalled) installation has no connection yet. Until the user
    // decides, the session report only verifies identity and surfaces
    // recovery candidates — it never binds automatically.
    if (!existingConnection) {
      return this.handleUnboundSession(
        clerkUserId,
        installation,
        Boolean(sessionDetected),
        normalizedFacebookUserId,
      );
    }

    const expectedFacebookUserId = existingConnection.facebookUserId?.trim();
    const identityMismatch =
      sessionDetected &&
      (!normalizedFacebookUserId ||
        Boolean(
          expectedFacebookUserId &&
          expectedFacebookUserId !== normalizedFacebookUserId,
        ));
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

    const connection = await this.updateConnectionForWorker(
      clerkUserId,
      installation,
      {
        status: connectionStatus,
        workerStatus,
        facebookSessionDetected: Boolean(sessionDetected),
        ...(normalizedFacebookUserId
          ? { detectedFacebookUserId: normalizedFacebookUserId }
          : {}),
        ...(shouldBindIdentity
          ? { facebookUserId: normalizedFacebookUserId }
          : {}),
      },
    );
    if (!connection) {
      throw new NotFoundException('Facebook connection not found.');
    }

    installation.facebookSessionDetected = Boolean(sessionDetected);
    if (normalizedFacebookUserId) {
      installation.detectedFacebookUserId = normalizedFacebookUserId;
    }
    installation.lastHeartbeat = new Date();
    await installation.save();

    return {
      installation: this.sanitizeInstallation(installation),
      connection: this.sanitizeConnection(connection),
      recoveryCandidates: [],
    };
  }

  /**
   * Session report for an installation that has no connection yet (a fresh
   * reinstall). Verifies the PostFlow user context (credential gate above) and
   * the detected Facebook identity, then either offers recovery candidates or
   * completes the new-connection flow. The installation is never bound to an
   * existing connection here — that requires an explicit user decision.
   */
  private async handleUnboundSession(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
    sessionDetected: boolean,
    detectedFacebookUserId?: string,
  ): Promise<{
    installation: Record<string, unknown>;
    connection: Record<string, unknown> | null;
    recoveryCandidates: RecoveryCandidate[];
  }> {
    installation.lastHeartbeat = new Date();

    if (!sessionDetected || !detectedFacebookUserId) {
      installation.facebookSessionDetected = false;
      await installation.save();
      return {
        installation: this.sanitizeInstallation(installation),
        connection: null,
        recoveryCandidates: [],
      };
    }

    installation.facebookSessionDetected = true;
    installation.detectedFacebookUserId = detectedFacebookUserId;
    await installation.save();

    const candidates = await this.findRecoveryCandidates(
      clerkUserId,
      installation,
      detectedFacebookUserId,
    );
    if (candidates.length > 0) {
      // Identity match only creates a suggestion. Binding happens exclusively
      // through POST /api/extensions/reconnect after the user chooses.
      return {
        installation: this.sanitizeInstallation(installation),
        connection: null,
        recoveryCandidates: candidates,
      };
    }

    // No recoverable previous connection: complete the new-connection flow.
    const normalizedInstanceId = installation.extensionInstanceId;
    if (!normalizedInstanceId) {
      return {
        installation: this.sanitizeInstallation(installation),
        connection: null,
        recoveryCandidates: [],
      };
    }
    const connection = await this.upsertConnection(
      clerkUserId,
      normalizedInstanceId,
      {
        status: FacebookConnectionStatus.CONNECTED,
        workerStatus: FacebookConnectionWorkerStatus.IDLE,
        facebookSessionDetected: true,
        facebookUserId: detectedFacebookUserId,
        detectedFacebookUserId,
        activeExtensionInstallationId: installation._id,
      },
    );
    if (connection) {
      installation.facebookConnectionId = connection._id;
      await installation.save();
    }

    return {
      installation: this.sanitizeInstallation(installation),
      connection: connection ? this.sanitizeConnection(connection) : null,
      recoveryCandidates: [],
    };
  }

  /**
   * Finds connections this PostFlow user owns that the newly detected Facebook
   * identity could explicitly recover. Suggestions only — never an auto-bind:
   *
   * - not archived (archived connections restore only through Archived)
   * - expected Facebook user id matches the newly detected one
   * - not currently publishing
   * - active installation offline, revoked, or missing
   */
  private async findRecoveryCandidates(
    clerkUserId: string,
    installation: ExtensionInstallationDocument,
    detectedFacebookUserId: string,
  ): Promise<RecoveryCandidate[]> {
    const connections = await this.connectionModel
      .find({
        clerkUserId,
        archivedAt: null,
        removedAt: null,
        facebookUserId: detectedFacebookUserId,
        workerStatus: { $ne: FacebookConnectionWorkerStatus.PUBLISHING },
        _id: { $ne: installation.facebookConnectionId ?? null },
      })
      .sort({ lastSeenAt: -1 })
      .limit(5)
      .exec();

    const candidates: RecoveryCandidate[] = [];
    for (const connection of connections) {
      const activeInstallation = connection.activeExtensionInstallationId
        ? await this.extensionModel
            .findById(connection.activeExtensionInstallationId)
            .exec()
        : null;

      if (activeInstallation) {
        if (String(activeInstallation._id) === String(installation._id))
          continue;
        const revoked =
          activeInstallation.status === ExtensionLifecycleStatus.REVOKED;
        const online = deriveConnectivity(
          activeInstallation.lastHeartbeat,
        ).isOnline;
        // A healthy live worker is not recoverable. A revoked installation may
        // still be online for a moment; it is a candidate and the reconnect
        // endpoint requires stronger confirmation while it stays online.
        if (!revoked && online) continue;
        candidates.push({
          connectionId: String(connection._id),
          displayName: connection.displayName ?? undefined,
          facebookUserId: connection.facebookUserId ?? undefined,
          activeInstallationOnline: online,
        });
      } else {
        candidates.push({
          connectionId: String(connection._id),
          displayName: connection.displayName ?? undefined,
          facebookUserId: connection.facebookUserId ?? undefined,
          activeInstallationOnline: false,
        });
      }
    }
    return candidates;
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
      throw new UnauthorizedException(
        'x-extension-instance-id header is required',
      );
    await this.updateConnectionName(
      clerkUserId,
      normalizedInstanceId,
      extensionName,
      true,
    );
    const connection = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );
    return { displayName: connection?.displayName ?? (typeof extensionName === 'string' ? normalizeExtensionName(extensionName) || null : installation.displayName ?? null) };
  }

  // ── Reinstall recovery (worker, explicit user decision) ───────────────────

  /**
   * Explicit reconnect for a reinstalled (or restored) installation.
   *
   * Called only after the user chose "Reconnect …" (or "Create a new
   * connection") — identity match alone never binds. On success the swap is
   * atomic from the caller's perspective: a single guarded findOneAndUpdate
   * decides the single winner, the old installation is revoked with reason
   * REPLACED, and the connection's ID, name, groups, jobs, and history are
   * preserved untouched.
   */
  async reconnect(
    clerkUserId: string,
    extensionInstanceId?: string,
    credential?: string,
    options?: {
      connectionId?: string;
      createNewConnection?: boolean;
      confirmReplacement?: boolean;
      approvalToken?: string;
    },
  ): Promise<Record<string, unknown>> {
    const installation = await this.verifyWorkerIdentity(
      clerkUserId,
      extensionInstanceId,
      credential,
    );
    const normalizedInstanceId = installation.extensionInstanceId;
    if (!normalizedInstanceId)
      throw new UnauthorizedException(
        'x-extension-instance-id header is required',
      );

    // Every recovery decision, including "Create a new connection", is made
    // only after this concrete installation has reported a Facebook identity.
    // The caller-controlled PostFlow user id and an installation credential
    // alone are not enough to create or inherit a logical connection.
    if (
      !installation.facebookSessionDetected ||
      !installation.detectedFacebookUserId
    ) {
      throw new ConflictException(
        'Facebook identity has not been verified for this installation.',
      );
    }

    // Explicit "Create a new connection" choice. Idempotent: if this
    // installation already has a connection, report it instead of duplicating.
    if (options?.createNewConnection) {
      const existing = await this.resolveWorkerConnection(
        clerkUserId,
        installation,
      );
      if (existing && !existing.archivedAt) {
        return this.toReconnectResult(existing, installation);
      }
      if (existing?.archivedAt) {
        throw new ConflictException(
          'This installation belongs to an archived connection. Restore it with a reconnect approval code.',
        );
      }
      const connection = await this.upsertConnection(
        clerkUserId,
        normalizedInstanceId,
        {
          status: FacebookConnectionStatus.CONNECTED,
          workerStatus: FacebookConnectionWorkerStatus.IDLE,
          facebookSessionDetected: true,
          facebookUserId: installation.detectedFacebookUserId,
          detectedFacebookUserId: installation.detectedFacebookUserId,
          activeExtensionInstallationId: installation._id,
        },
      );
      if (!connection) {
        throw new ConflictException(
          'Could not create the connection. Try again.',
        );
      }
      connection.activeExtensionInstallationId = installation._id;
      await connection.save();
      installation.facebookConnectionId = connection._id;
      await installation.save();
      return this.toReconnectResult(connection, installation);
    }

    // Target resolution: an explicit connection id, or a dashboard-issued
    // approval code whose hash identifies the connection to restore.
    let targetConnectionId = options?.connectionId?.trim();
    if (!targetConnectionId && options?.approvalToken) {
      const byToken = await this.connectionModel
        .findOne({
          clerkUserId,
          reconnectApprovalTokenHash: hashInstallationCredential(
            options.approvalToken,
          ),
        })
        .exec();
      if (!byToken) {
        throw new ForbiddenException('This reconnect approval is invalid.');
      }
      targetConnectionId = String(byToken._id);
    }
    if (!targetConnectionId) {
      throw new BadRequestException(
        'connectionId or createNewConnection is required.',
      );
    }

    const target = await this.requireOwnedConnection(
      clerkUserId,
      targetConnectionId,
    );

    // Verify the new installation's detected Facebook identity before any
    // rebind; ownership plus a matching identity is still not an auto-bind.
    if (
      !target.facebookUserId ||
      target.facebookUserId !== installation.detectedFacebookUserId
    ) {
      throw new ConflictException(
        'The detected Facebook account does not match this connection.',
      );
    }

    // Idempotency: a network retry after a completed reconnect reports
    // success again instead of failing or re-running the swap.
    const currentBinding = await this.resolveWorkerConnection(
      clerkUserId,
      installation,
    );
    if (currentBinding && String(currentBinding._id) === String(target._id)) {
      return this.toReconnectResult(target, installation);
    }
    if (currentBinding) {
      throw new ConflictException(
        'This installation is already connected to a different connection. Disconnect it first.',
      );
    }

    // Archived connections restore only through an explicit, unexpired,
    // single-use approval issued by the dashboard.
    let approvalVerified = false;
    if (options?.approvalToken && target.reconnectApprovalTokenHash) {
      approvalVerified = verifyInstallationCredential(
        options.approvalToken,
        target.reconnectApprovalTokenHash,
      );
    }
    if (target.archivedAt) {
      if (!options?.approvalToken) {
        throw new ForbiddenException(
          'Restoring an archived connection requires a reconnect approval code.',
        );
      }
      if (
        !target.reconnectApprovalTokenHash ||
        !target.reconnectApprovalExpiresAt
      ) {
        throw new ForbiddenException('No reconnect approval is pending.');
      }
      if (target.reconnectApprovalUsedAt) {
        throw new ForbiddenException(
          'This reconnect approval has already been used.',
        );
      }
      if (target.reconnectApprovalExpiresAt.getTime() < Date.now()) {
        throw new ForbiddenException('This reconnect approval has expired.');
      }
      if (!approvalVerified) {
        throw new ForbiddenException('This reconnect approval is invalid.');
      }
    }

    const previousActiveId = target.activeExtensionInstallationId ?? null;
    // Also resolve a holder whose active binding is unset (mid-disconnect) so
    // the swap can revoke it and keep the one-active-installation index
    // satisfied when the new installation takes the binding.
    const previousInstallation = await this.findBoundInstallation(target);

    if (
      previousInstallation &&
      String(previousInstallation._id) !== String(installation._id)
    ) {
      const online = deriveConnectivity(
        previousInstallation.lastHeartbeat,
      ).isOnline;
      const alive =
        previousInstallation.status !== ExtensionLifecycleStatus.REVOKED;
      if (alive && online) {
        if (target.workerStatus === FacebookConnectionWorkerStatus.PUBLISHING) {
          throw new ConflictException(
            'The previous extension is publishing right now. Try again after the job finishes.',
          );
        }
        if (!options?.confirmReplacement) {
          throw new ConflictException(
            'REPLACEMENT_CONFIRMATION_REQUIRED: The previous extension is still online. Confirm the replacement to continue.',
          );
        }
      }
    }

    // Atomic claim: this single guarded findOneAndUpdate decides the single
    // winner. A concurrent reconnect by another installation fails the guard;
    // a retry of an already-completed reconnect matches the caller's own
    // binding and succeeds idempotently. Unarchiving and approval consumption
    // happen in the same write.
    const claimSet: Record<string, unknown> = {
      activeExtensionInstallationId: installation._id,
      extensionInstanceId: normalizedInstanceId,
      status: FacebookConnectionStatus.CONNECTED,
      workerStatus: FacebookConnectionWorkerStatus.IDLE,
      facebookSessionDetected: true,
      detectedFacebookUserId: installation.detectedFacebookUserId,
      lastSeenAt: new Date(),
    };
    if (approvalVerified) {
      claimSet.reconnectApprovalUsedAt = new Date();
    }
    const claimUpdate: Record<string, unknown> = { $set: claimSet };
    if (target.archivedAt) {
      claimUpdate.$unset = {
        archivedAt: 1,
        archivedByClerkUserId: 1,
        archiveReason: 1,
      };
    }
    return this.runRecoveryTransaction(async (session) => {
      const claimQuery = this.connectionModel.findOneAndUpdate(
        {
          _id: target._id,
          $or: [
            { activeExtensionInstallationId: previousActiveId },
            { activeExtensionInstallationId: installation._id },
          ],
        },
        claimUpdate,
        { returnDocument: 'after' },
      );
      if (session) claimQuery.session(session);
      const claimed = await claimQuery.exec();
      if (!claimed) {
        throw new ConflictException(
          'RECONNECT_CONFLICT: Another reconnect already claimed this connection. Refresh and try again.',
        );
      }

      // Revoke the old installation with reason REPLACED only after winning
      // the guarded claim. The transaction makes the revocation and both
      // sides of the new binding visible together.
      if (
        previousInstallation &&
        String(previousInstallation._id) !== String(installation._id) &&
        previousInstallation.status !== ExtensionLifecycleStatus.REVOKED
      ) {
        const previousStatus = previousInstallation.status;
        previousInstallation.replacedByInstallationId = installation._id;
        await this.revokeInstallation(previousInstallation, {
          reason: ExtensionRevocationReason.REPLACED,
          byClerkUserId: clerkUserId,
          actor: ExtensionLifecycleActor.WORKER,
          session,
        });
        await this.recordAudit(
          ExtensionLifecycleAuditEventName.INSTALLATION_REPLACED,
          {
            clerkUserId,
            installation: previousInstallation,
            connectionId: target._id,
            actor: ExtensionLifecycleActor.WORKER,
            previousLifecycle: previousStatus,
            nextLifecycle: ExtensionLifecycleStatus.REVOKED,
            reason: ExtensionRevocationReason.REPLACED,
          },
          session,
        );
      }

      installation.facebookConnectionId = target._id;
      if (claimed.displayName) {
        installation.displayName = claimed.displayName;
        installation.displayNameKey = normalizeExtensionNameKey(claimed.displayName);
      }
      await installation.save(session ? { session } : undefined);

      await this.recordAudit(
        ExtensionLifecycleAuditEventName.RECOVERY_ACCEPTED,
        {
          clerkUserId,
          installation,
          connectionId: target._id,
          actor: ExtensionLifecycleActor.WORKER,
          previousLifecycle: installation.status,
          nextLifecycle: installation.status,
        },
        session,
      );

      return this.toReconnectResult(claimed, installation);
    });
  }

  // ── Lifecycle mutations (dashboard, owner-authorized) ─────────────────────

  async pauseConnection(clerkUserId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(
      clerkUserId,
      connectionId,
    );
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

    await this.recordAudit(
      ExtensionLifecycleAuditEventName.INSTALLATION_PAUSED,
      {
        clerkUserId,
        installation,
        connectionId: connection._id,
        actor: ExtensionLifecycleActor.DASHBOARD,
        previousLifecycle: previous,
        nextLifecycle: ExtensionLifecycleStatus.PAUSED,
      },
    );

    return this.toConnectionState(connection, installation);
  }

  async resumeConnection(clerkUserId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(
      clerkUserId,
      connectionId,
    );
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

    await this.recordAudit(
      ExtensionLifecycleAuditEventName.INSTALLATION_RESUMED,
      {
        clerkUserId,
        installation,
        connectionId: connection._id,
        actor: ExtensionLifecycleActor.DASHBOARD,
        previousLifecycle: previous,
        nextLifecycle: ExtensionLifecycleStatus.ACTIVE,
      },
    );

    return this.toConnectionState(connection, installation);
  }

  async disconnectConnection(
    clerkUserId: string,
    connectionId: string,
    force = false,
  ) {
    const connection = await this.requireOwnedConnection(
      clerkUserId,
      connectionId,
    );
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
    const connection = await this.requireOwnedConnection(
      clerkUserId,
      connectionId,
    );
    const installation = await this.findBoundInstallation(connection);

    if (
      installation &&
      installation.status !== ExtensionLifecycleStatus.REVOKED
    ) {
      await this.revokeInstallation(installation, {
        reason: ExtensionRevocationReason.REMOVED,
        byClerkUserId: clerkUserId,
        actor: ExtensionLifecycleActor.DASHBOARD,
      });
      await this.clearConnectionBindingIfSame(connection, installation);
    }

    if (installation && !installation.removedAt) {
      installation.removedAt = new Date();
      await installation.save();
    }
    if (!connection.removedAt) {
      connection.removedAt = new Date();
      connection.status = FacebookConnectionStatus.DISCONNECTED;
      connection.workerStatus = FacebookConnectionWorkerStatus.OFFLINE;
      connection.facebookSessionDetected = false;
      connection.displayNameKey = undefined;
      await connection.save();
      await this.recordAudit(
        ExtensionLifecycleAuditEventName.CONNECTION_REMOVED,
        {
          clerkUserId,
          installation,
          connectionId: connection._id,
          actor: ExtensionLifecycleActor.DASHBOARD,
          reason: ExtensionRevocationReason.REMOVED,
        },
      );
    }

    if (installation && this.platformConnectionModel) await this.platformConnectionModel.updateMany({
      clerkUserId, activeExtensionInstallationId: installation._id, removedAt: null,
    }, {
      $set: { removedAt: new Date(), status: PlatformConnectionStatus.DISCONNECTED,
        workerStatus: PlatformConnectionWorkerStatus.OFFLINE, sessionDetected: false },
      $unset: { displayNameKey: 1 },
    });

    return this.toConnectionState(connection, installation);
  }

  async issueReconnectApproval(clerkUserId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(
      clerkUserId,
      connectionId,
    );
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
    const connection = await this.requireOwnedConnection(
      clerkUserId,
      connectionId,
    );
    if (
      !connection.reconnectApprovalTokenHash ||
      !connection.reconnectApprovalExpiresAt
    ) {
      throw new ForbiddenException('No reconnect approval is pending.');
    }
    if (connection.reconnectApprovalUsedAt) {
      throw new ForbiddenException(
        'This reconnect approval has already been used.',
      );
    }
    if (connection.reconnectApprovalExpiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('This reconnect approval has expired.');
    }
    if (
      !verifyInstallationCredential(
        approvalToken,
        connection.reconnectApprovalTokenHash,
      )
    ) {
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
        .find({ clerkUserId, archivedAt: null, removedAt: null })
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
        (boundId ? installationByConnectionId.get(boundId) : undefined) ??
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

  async listPlatformConnections(
    clerkUserId: string,
    platform?: 'INSTAGRAM' | 'TIKTOK',
  ) {
    if (!this.platformConnectionModel) return [];
    const connections = await this.platformConnectionModel
      .find({
        clerkUserId,
        ...(platform ? { platform: platform as any } : {}),
        archivedAt: null, removedAt: null,
      })
      .sort({ lastSeenAt: -1, createdAt: -1 })
      .lean()
      .exec();
    const installationIds = (connections as unknown as PlatformConnectionDocument[])
      .map((connection) => connection.activeExtensionInstallationId)
      .filter((id): id is Types.ObjectId => Boolean(id));
    const installations = installationIds.length
      ? await this.extensionModel
          .find({ clerkUserId, _id: { $in: installationIds } })
          .lean()
          .exec()
      : [];
    // The shared Chrome Profile name is historically stored on the durable
    // Facebook connection (the installation only received a name when the
    // profile was created without Facebook). Resolve that parent label once
    // so Instagram/TikTok rows use the same name in Create Post.
    const facebookConnectionIds = (installations as unknown as Array<Record<string, unknown>>)
      .map((installation) => installation.facebookConnectionId)
      .filter((id): id is Types.ObjectId => Boolean(id));
    const facebookConnections = facebookConnectionIds.length
      ? await this.connectionModel
          .find({ clerkUserId, _id: { $in: facebookConnectionIds } })
          .select('_id displayName')
          .lean()
          .exec()
      : [];
    const facebookNameById = new Map(
      (facebookConnections as unknown as Array<Record<string, unknown>>).map((connection) => [
        String(connection._id),
        typeof connection.displayName === 'string' ? connection.displayName : null,
      ]),
    );
    const installationById = new Map(
      (installations as unknown as Array<Record<string, unknown>>).map((installation) => [
        String(installation._id),
        {
          ...installation,
          displayName:
            (typeof installation.displayName === 'string' && installation.displayName.trim())
              ? installation.displayName
              : facebookNameById.get(String(installation.facebookConnectionId)) ?? null,
        },
      ]),
    );
    return (connections as unknown as PlatformConnectionDocument[]).map(
      (connection) => sanitizePlatformConnection(
        connection,
        installationById.get(String(connection.activeExtensionInstallationId)),
      ),
    );
  }

  async listArchivedConnections(
    clerkUserId: string,
  ): Promise<ConnectionState[]> {
    const [connections, installations] = await Promise.all([
      this.connectionModel
        .find({ clerkUserId, archivedAt: { $ne: null }, removedAt: null })
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
        (boundId ? installationByConnectionId.get(boundId) : undefined) ??
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
    const instanceId =
      installation?.extensionInstanceId ?? connection.extensionInstanceId;
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
      extensionInstanceIdMasked: maskExtensionInstanceId(
        instanceId ?? undefined,
      ),
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

  private toReconnectResult(
    connection: ConnectionLike,
    installation?: InstallationLike | null,
  ): ConnectionState & { connectionId: string } {
    return {
      ...this.toConnectionState(connection, installation),
      connectionId: String(connection._id),
    };
  }

  private sanitizeConnection(
    connection: FacebookConnectionDocument,
  ): Record<string, unknown> {
    const document = connection.toObject
      ? (connection.toObject() as unknown)
      : connection;
    const safe = { ...(document as Record<string, unknown>) };
    delete safe.reconnectApprovalTokenHash;
    delete safe.reconnectApprovalUsedAt;
    return { ...safe, _id: String(connection._id) };
  }

  private sanitizeInstallation(
    installation: ExtensionInstallationDocument,
  ): Record<string, unknown> {
    const document = installation.toObject
      ? (installation.toObject() as unknown)
      : installation;
    const safe = { ...(document as Record<string, unknown>) };
    delete safe.credentialHash;
    delete safe.restoreApprovalTokenHash;
    return { ...safe, _id: String(installation._id) };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async requireOwnedConnection(
    clerkUserId: string,
    connectionId: string,
  ) {
    if (!Types.ObjectId.isValid(connectionId)) {
      throw new NotFoundException('Facebook connection not found.');
    }
    const connection = await this.connectionModel
      .findOne({ _id: connectionId, clerkUserId })
      .exec();
    if (!connection || connection.removedAt) {
      throw new NotFoundException('Facebook connection not found.');
    }
    return connection;
  }

  private async runRecoveryTransaction<T>(
    operation: (session?: ClientSession) => Promise<T>,
  ): Promise<T> {
    // Unit-test model doubles do not expose a Mongoose connection. Production
    // models do, and recovery must commit the connection claim, old-worker
    // revocation, new binding, and audits as one transaction.
    const database = this.connectionModel.db;
    if (!database?.startSession) return operation();

    const session = await database.startSession();
    try {
      session.startTransaction();
      const result = await operation(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
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
      candidates.find(
        (candidate) => candidate.status !== ExtensionLifecycleStatus.REVOKED,
      ) ??
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
      String(connection.activeExtensionInstallationId) ===
        String(installation._id)
    ) {
      await this.connectionModel.updateOne(
        { _id: connection._id, activeExtensionInstallationId: installation._id },
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
      session?: ClientSession;
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
    await installation.save(
      options.session ? { session: options.session } : undefined,
    );

    await this.recordAudit(
      ExtensionLifecycleAuditEventName.INSTALLATION_REVOKED,
      {
        clerkUserId: installation.clerkUserId,
        installation,
        connectionId: installation.facebookConnectionId,
        actor: options.actor,
        previousLifecycle: previous,
        nextLifecycle: ExtensionLifecycleStatus.REVOKED,
        reason: options.reason,
      },
      options.session,
    );
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
    if (installation.status !== ExtensionLifecycleStatus.REVOKE_PENDING)
      return false;
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
        {
          _id: installation.facebookConnectionId,
          activeExtensionInstallationId: installation._id,
        },
        { $unset: { activeExtensionInstallationId: 1 } },
      );
    }
    return true;
  }

  private async updateConnectionName(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    extensionName: unknown,
    explicitRename = false,
  ) {
    if (extensionName === undefined) return;
    if (typeof extensionName !== 'string') {
      throw new BadRequestException('Extension name must be text.');
    }

    let normalizedName = normalizeExtensionName(extensionName);
    if (normalizedName.length > 60) {
      throw new BadRequestException(
        'Extension name must be 60 characters or fewer.',
      );
    }

    const filter = this.getConnectionFilter(clerkUserId, extensionInstanceId);
    const installation = await this.extensionModel.findOne({ clerkUserId, extensionInstanceId }).exec();
    // Heartbeats must not overwrite a dashboard rename with a cached popup label.
    if (!explicitRename && installation?.displayName) normalizedName = installation.displayName;
    if (!normalizedName) {
      if (explicitRename) await this.extensionModel.updateOne({ clerkUserId, extensionInstanceId }, {
        $unset: { displayName: 1, displayNameKey: 1 },
      });
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
    // An Instagram/TikTok-only profile can be named without a Facebook record.
    if (!current) {
      await this.extensionModel.updateOne({ clerkUserId, extensionInstanceId }, {
        $set: { displayName: normalizedName, displayNameKey },
      });
      return;
    }

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
      throw new ConflictException(
        'An extension with this name already exists.',
      );
    }

    try {
      await this.connectionModel
        .findOneAndUpdate(filter, {
          $set: { displayName: normalizedName, displayNameKey },
        })
        .exec();
      await this.extensionModel.updateOne({ clerkUserId, extensionInstanceId }, {
        $set: { displayName: normalizedName, displayNameKey },
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'An extension with this name already exists.',
        );
      }
      throw error;
    }
  }

  async renameConnection(
    clerkUserId: string,
    connectionId: string,
    name: unknown,
  ) {
    const connection = await this.requireOwnedConnection(
      clerkUserId,
      connectionId,
    );
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
      throw new ConflictException(
        'An extension with this name already exists.',
      );
    }

    try {
      connection.displayName = normalizedName;
      connection.displayNameKey = displayNameKey;
      await connection.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'An extension with this name already exists.',
        );
      }
      throw error;
    }
    if (connection.activeExtensionInstallationId) {
      await this.extensionModel.updateOne({ _id: connection.activeExtensionInstallationId, clerkUserId }, {
        $set: { displayName: normalizedName, displayNameKey },
      });
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

function normalizePlatformUsername(value?: string): string | undefined {
  const normalized = value?.trim().replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  if (!normalized || !/^[A-Za-z0-9._]+$/.test(normalized)) return undefined;
  return normalized.toLowerCase();
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

function mapPlatformWorkerStatusToConnectionStatus(
  workerStatus: PlatformConnectionWorkerStatus,
): PlatformConnectionStatus | undefined {
  switch (workerStatus) {
    case PlatformConnectionWorkerStatus.LOGIN_REQUIRED:
      return PlatformConnectionStatus.LOGIN_REQUIRED;
    case PlatformConnectionWorkerStatus.ACCOUNT_MISMATCH:
      return PlatformConnectionStatus.ACCOUNT_MISMATCH;
    case PlatformConnectionWorkerStatus.BLOCKED:
      return PlatformConnectionStatus.BLOCKED;
    case PlatformConnectionWorkerStatus.IDLE:
    case PlatformConnectionWorkerStatus.ONLINE:
    case PlatformConnectionWorkerStatus.PUBLISHING:
      return PlatformConnectionStatus.CONNECTED;
    default:
      return undefined;
  }
}

function sanitizePlatformConnection(
  connection: PlatformConnectionDocument,
  installation?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    _id: connection._id,
    clerkUserId: connection.clerkUserId,
    platform: connection.platform,
    displayName: connection.displayName,
    extensionName: installation?.displayName ?? null,
    extensionInstanceIdMasked: installation?.extensionInstanceId
      ? maskExtensionInstanceId(String(installation.extensionInstanceId))
      : null,
    activeExtensionInstallationId: connection.activeExtensionInstallationId
      ? String(connection.activeExtensionInstallationId)
      : null,
    externalAccountId: connection.externalAccountId,
    externalUsername: connection.externalUsername,
    detectedExternalAccountId: connection.detectedExternalAccountId,
    detectedExternalUsername: connection.detectedExternalUsername,
    status: connection.status,
    workerStatus: connection.workerStatus,
    sessionDetected: connection.sessionDetected,
    sessionEvidenceState: connection.sessionEvidenceState,
    sessionVerifiedAt: connection.sessionVerifiedAt,
    sessionEvidenceSource: connection.sessionEvidenceSource,
    lastSeenAt: connection.lastSeenAt,
    archivedAt: connection.archivedAt,
    legacyFacebookConnectionId: connection.legacyFacebookConnectionId,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
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
    (candidate) => candidate.status !== ExtensionLifecycleStatus.REVOKED,
  );
  return active[0] ?? candidates[0];
}
