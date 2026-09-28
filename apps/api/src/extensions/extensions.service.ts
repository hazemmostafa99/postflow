import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ExtensionInstallation,
  ExtensionInstallationDocument,
} from '../schemas/extension-installation.schema';
import {
  FacebookConnection,
  FacebookConnectionDocument,
  FacebookConnectionStatus,
  FacebookConnectionWorkerStatus,
} from '../schemas/facebook-connection.schema';

@Injectable()
export class ExtensionsService {
  constructor(
    @InjectModel(ExtensionInstallation.name)
    private readonly extensionModel: Model<ExtensionInstallationDocument>,
    @InjectModel(FacebookConnection.name)
    private readonly connectionModel: Model<FacebookConnectionDocument>,
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
    extensionInstanceId: string | undefined,
    updates: Record<string, unknown> = {},
  ) {
    const normalizedInstanceId = extensionInstanceId?.trim();
    const setOnInsert: Record<string, unknown> = {
      clerkUserId,
      ...(normalizedInstanceId
        ? { extensionInstanceId: normalizedInstanceId }
        : {}),
    };

    // MongoDB rejects an upsert when the same path appears in both $set and
    // $setOnInsert. Only provide defaults for fields not supplied by updates.
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

  async updateWorkerStatus(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    workerStatus: FacebookConnectionWorkerStatus,
    _reason?: string,
  ) {
    const connectionStatus =
      workerStatus === FacebookConnectionWorkerStatus.LOGIN_REQUIRED
        ? FacebookConnectionStatus.LOGIN_REQUIRED
        : workerStatus === FacebookConnectionWorkerStatus.ACCOUNT_MISMATCH
          ? FacebookConnectionStatus.ACCOUNT_MISMATCH
          : workerStatus === FacebookConnectionWorkerStatus.BLOCKED
            ? FacebookConnectionStatus.BLOCKED
            : workerStatus === FacebookConnectionWorkerStatus.IDLE ||
                workerStatus === FacebookConnectionWorkerStatus.ONLINE ||
                workerStatus === FacebookConnectionWorkerStatus.PUBLISHING
              ? FacebookConnectionStatus.CONNECTED
              : undefined;
    const connection = await this.upsertConnection(
      clerkUserId,
      extensionInstanceId,
      {
        workerStatus,
        ...(connectionStatus ? { status: connectionStatus } : {}),
      },
    );
    if (!connection) {
      throw new NotFoundException('Facebook connection not found.');
    }
    return connection;
  }

  async listConnections(clerkUserId: string) {
    const [connections, installations] = await Promise.all([
      this.connectionModel
        .find({ clerkUserId })
        .sort({ lastSeenAt: -1, createdAt: -1 })
        .lean()
        .exec(),
      this.extensionModel
        .find({ clerkUserId })
        .select('extensionInstanceId status lastHeartbeat facebookSessionDetected facebookConnectionId')
        .lean()
        .exec(),
    ]);
    const installationByConnectionId = new Map(
      installations
        .filter((installation) => installation.facebookConnectionId)
        .map((installation) => [
          String(installation.facebookConnectionId),
          installation,
        ]),
    );

    return connections.map((connection) => {
      const installation = installationByConnectionId.get(String(connection._id));
      return {
        ...connection,
        _id: String(connection._id),
        extensionInstanceId:
          connection.extensionInstanceId ?? installation?.extensionInstanceId,
        installationStatus: installation?.status,
        lastHeartbeat: installation?.lastHeartbeat,
        facebookSessionDetected:
          connection.facebookSessionDetected ?? installation?.facebookSessionDetected ?? false,
      };
    });
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

    const normalizedName = extensionName.trim();
    if (normalizedName.length > 60) {
      throw new BadRequestException('Extension name must be 60 characters or fewer.');
    }

    await this.connectionModel
      .findOneAndUpdate(
        this.getConnectionFilter(clerkUserId, extensionInstanceId),
        normalizedName
          ? { $set: { displayName: normalizedName } }
          : { $unset: { displayName: 1 } },
      )
      .exec();
  }

  /**
   * Register or retrieve an existing installation for the user.
   * Idempotent — safe to call on every extension startup.
   */
  async register(
    clerkUserId: string,
    extensionInstanceId?: string,
    extensionName?: unknown,
  ): Promise<ExtensionInstallationDocument> {
    const connection = await this.upsertConnection(
      clerkUserId,
      extensionInstanceId,
      { workerStatus: FacebookConnectionWorkerStatus.ONLINE },
    );
    await this.updateConnectionName(clerkUserId, extensionInstanceId, extensionName);
    const filter = this.getInstallationFilter(clerkUserId, extensionInstanceId);
    const existing = await this.extensionModel.findOne(filter).exec();
    if (existing) {
      existing.status = 'ACTIVE';
      existing.lastHeartbeat = new Date();
      existing.facebookConnectionId = connection?._id;
      return existing.save();
    }
    const installation = new this.extensionModel({
      clerkUserId,
      ...(extensionInstanceId?.trim()
        ? { extensionInstanceId: extensionInstanceId.trim() }
        : {}),
      status: 'ACTIVE',
      lastHeartbeat: new Date(),
      facebookConnectionId: connection?._id,
    });
    return installation.save();
  }

  /**
   * Update the heartbeat timestamp to indicate the extension is alive.
   */
  async heartbeat(
    clerkUserId: string,
    extensionInstanceId?: string,
    extensionName?: unknown,
  ): Promise<ExtensionInstallationDocument> {
    const existingConnection = await this.connectionModel
      .findOne(this.getConnectionFilter(clerkUserId, extensionInstanceId))
      .select('workerStatus')
      .lean()
      .exec();
    const persistentWorkerStatuses = new Set([
      FacebookConnectionWorkerStatus.PUBLISHING,
      FacebookConnectionWorkerStatus.BLOCKED,
      FacebookConnectionWorkerStatus.LOGIN_REQUIRED,
      FacebookConnectionWorkerStatus.ACCOUNT_MISMATCH,
      FacebookConnectionWorkerStatus.CHECKPOINT_OR_VERIFICATION,
      FacebookConnectionWorkerStatus.CAPTCHA_OR_CHALLENGE,
      FacebookConnectionWorkerStatus.MANUAL_INTERVENTION_REQUIRED,
    ]);
    const connection = await this.upsertConnection(
      clerkUserId,
      extensionInstanceId,
      {
        workerStatus:
          existingConnection?.workerStatus &&
          persistentWorkerStatuses.has(existingConnection.workerStatus)
            ? existingConnection.workerStatus
            : FacebookConnectionWorkerStatus.ONLINE,
      },
    );
    await this.updateConnectionName(clerkUserId, extensionInstanceId, extensionName);
    const normalizedInstanceId = extensionInstanceId?.trim();
    const installation = await this.extensionModel
      .findOneAndUpdate(
        this.getInstallationFilter(clerkUserId, extensionInstanceId),
        {
          $set: { lastHeartbeat: new Date(), status: 'ACTIVE' },
          $setOnInsert: {
            clerkUserId,
            ...(normalizedInstanceId
              ? { extensionInstanceId: normalizedInstanceId }
              : {}),
          },
        },
        { returnDocument: 'after', upsert: true },
      )
      .exec();

    if (!installation) {
      throw new NotFoundException(
        'Extension installation not found. Please register first.',
      );
    }
    installation.facebookConnectionId = connection?._id;
    await installation.save();
    return installation;
  }

  /**
   * Update the Facebook session status reported by the extension.
   */
  async updateSession(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    sessionDetected: boolean,
    detectedFacebookUserId?: string,
  ): Promise<{
    installation: ExtensionInstallationDocument;
    connection: FacebookConnectionDocument;
  }> {
    const normalizedFacebookUserId = detectedFacebookUserId?.trim() || undefined;
    const existingConnection = await this.connectionModel
      .findOne(this.getConnectionFilter(clerkUserId, extensionInstanceId))
      .exec();
    const expectedFacebookUserId = existingConnection?.facebookUserId?.trim();
    const identityMismatch = sessionDetected && (
      !normalizedFacebookUserId ||
      Boolean(expectedFacebookUserId && expectedFacebookUserId !== normalizedFacebookUserId)
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
        : existingConnection && new Set([
            FacebookConnectionWorkerStatus.PUBLISHING,
            FacebookConnectionWorkerStatus.BLOCKED,
            FacebookConnectionWorkerStatus.CHECKPOINT_OR_VERIFICATION,
            FacebookConnectionWorkerStatus.CAPTCHA_OR_CHALLENGE,
            FacebookConnectionWorkerStatus.MANUAL_INTERVENTION_REQUIRED,
          ]).has(existingConnection.workerStatus)
          ? existingConnection.workerStatus
          : FacebookConnectionWorkerStatus.IDLE;
    const connection = await this.upsertConnection(
      clerkUserId,
      extensionInstanceId,
      {
        status: connectionStatus,
        workerStatus,
        facebookSessionDetected: sessionDetected,
        ...(normalizedFacebookUserId
          ? { detectedFacebookUserId: normalizedFacebookUserId }
          : {}),
        ...(shouldBindIdentity
          ? { facebookUserId: normalizedFacebookUserId }
          : {}),
      },
    );
    const normalizedInstanceId = extensionInstanceId?.trim();
    const installation = await this.extensionModel
      .findOneAndUpdate(
        this.getInstallationFilter(clerkUserId, extensionInstanceId),
        {
          $set: {
            facebookSessionDetected: sessionDetected,
            lastHeartbeat: new Date(),
          },
          $setOnInsert: {
            clerkUserId,
            status: 'ACTIVE',
            ...(normalizedInstanceId
              ? { extensionInstanceId: normalizedInstanceId }
              : {}),
          },
        },
        { returnDocument: 'after', upsert: true },
      )
      .exec();

    if (!installation) {
      throw new NotFoundException(
        'Extension installation not found. Please register first.',
      );
    }
    installation.facebookConnectionId = connection?._id;
    await installation.save();
    if (!connection) {
      throw new NotFoundException('Facebook connection could not be resolved.');
    }
    return { installation, connection };
  }
}
