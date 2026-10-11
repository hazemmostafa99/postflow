import 'dotenv/config';
import mongoose from 'mongoose';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const argumentsProvided = process.argv.slice(2);
if (argumentsProvided.includes('--help')) {
  console.log(
    'Usage: node scripts/migrate-extension-lifecycle.mjs (--report-only | --apply)',
  );
  process.exit(0);
}

const reportOnly = argumentsProvided.includes('--report-only');
const applyChanges = argumentsProvided.includes('--apply');
if (reportOnly === applyChanges) {
  throw new Error('Choose exactly one mode: --report-only or --apply.');
}

const ACTIVE_STATUSES = new Set(['ACTIVE', 'PAUSED', 'REVOKE_PENDING']);
const STATUS_MIGRATIONS = new Map([
  ['ACTIVE', 'ACTIVE'],
  ['PAUSED', 'PAUSED'],
  ['REVOKE_PENDING', 'REVOKE_PENDING'],
  ['REVOKED', 'REVOKED'],
  ['INACTIVE', 'PAUSED'],
  ['UNINSTALLED', 'REVOKED'],
]);

await mongoose.connect(databaseUrl);

try {
  const database = mongoose.connection.db;
  const installations = database.collection('extensioninstallations');
  const connections = database.collection('facebookconnections');
  const installationDocuments = await installations.find({}).toArray();
  const connectionDocuments = await connections.find({}).toArray();
  const now = new Date();

  const byInstanceId = new Map();
  const byConnectionId = new Map();
  const updates = [];
  const unknownStatuses = [];

  for (const installation of installationDocuments) {
    const rawStatus = typeof installation.status === 'string'
      ? installation.status
      : 'ACTIVE';
    const nextStatus = STATUS_MIGRATIONS.get(rawStatus);
    if (!nextStatus) {
      unknownStatuses.push({ id: String(installation._id), status: rawStatus });
    }
    const normalizedStatus = nextStatus ?? 'REVOKED';
    const update = { $set: {} };

    if (installation.status !== normalizedStatus) {
      update.$set.status = normalizedStatus;
    }
    if (!installation.statusChangedAt) {
      update.$set.statusChangedAt = installation.createdAt ?? now;
    }
    if (typeof installation.credentialVersion !== 'number') {
      update.$set.credentialVersion = 0;
    }
    if (normalizedStatus === 'REVOKED' && !installation.revokedAt) {
      update.$set.revokedAt = installation.statusChangedAt ?? installation.createdAt ?? now;
      update.$set.revocationReason = rawStatus === 'UNINSTALLED'
        ? 'REMOVED'
        : 'MIGRATION';
    }

    if (Object.keys(update.$set).length > 0) {
      updates.push({ id: installation._id, update });
    }

    if (installation.extensionInstanceId) {
      const list = byInstanceId.get(installation.extensionInstanceId) ?? [];
      list.push(installation);
      byInstanceId.set(installation.extensionInstanceId, list);
    }
    if (installation.facebookConnectionId && ACTIVE_STATUSES.has(normalizedStatus)) {
      const key = String(installation.facebookConnectionId);
      const list = byConnectionId.get(key) ?? [];
      list.push(installation);
      byConnectionId.set(key, list);
    }
  }

  const duplicateInstanceIds = [...byInstanceId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([extensionInstanceId, list]) => ({
      extensionInstanceId,
      installationIds: list.map((item) => String(item._id)),
    }));
  const duplicateBindings = [...byConnectionId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([connectionId, list]) => ({
      connectionId,
      installationIds: list.map((item) => String(item._id)),
    }));

  const unresolvedConnectionPointers = connectionDocuments.filter((connection) => {
    if (!connection.extensionInstanceId) return false;
    const candidates = byConnectionId.get(String(connection._id)) ?? [];
    return candidates.length !== 1 ||
      candidates[0].extensionInstanceId !== connection.extensionInstanceId;
  }).map((connection) => String(connection._id));

  console.log(`Mode: ${reportOnly ? 'REPORT ONLY' : 'APPLY'}.`);
  console.log(`Installations inspected: ${installationDocuments.length}.`);
  console.log(`Installation records requiring backfill: ${updates.length}.`);
  console.log(`Duplicate instance IDs: ${duplicateInstanceIds.length}.`);
  console.log(`Duplicate active connection bindings: ${duplicateBindings.length}.`);
  console.log(`Unresolved legacy connection pointers: ${unresolvedConnectionPointers.length}.`);
  console.log(`Unknown legacy statuses: ${unknownStatuses.length}.`);

  if (duplicateInstanceIds.length > 0) {
    console.log('Duplicate instance ID sample:', duplicateInstanceIds.slice(0, 10));
  }
  if (duplicateBindings.length > 0) {
    console.log('Duplicate active binding sample:', duplicateBindings.slice(0, 10));
  }
  if (unknownStatuses.length > 0) {
    console.log('Unknown status sample:', unknownStatuses.slice(0, 10));
  }

  if (!reportOnly) {
    if (duplicateInstanceIds.length > 0 || duplicateBindings.length > 0) {
      throw new Error(
        'Resolve duplicate instance IDs and active connection bindings before applying lifecycle indexes.',
      );
    }

    for (const item of updates) {
      await installations.updateOne({ _id: item.id }, item.update);
    }

    for (const connection of connectionDocuments) {
      const candidates = byConnectionId.get(String(connection._id)) ?? [];
      if (candidates.length !== 1) continue;
      const installation = candidates[0];
      await connections.updateOne(
        { _id: connection._id },
        {
          $set: {
            activeExtensionInstallationId: installation._id,
            ...(installation.extensionInstanceId
              ? { extensionInstanceId: installation.extensionInstanceId }
              : {}),
          },
        },
      );
    }

    await installations.createIndex(
      { extensionInstanceId: 1 },
      { unique: true, sparse: true, name: 'extensionInstanceId_1' },
    );
    await installations.createIndex(
      { facebookConnectionId: 1 },
      {
        unique: true,
        partialFilterExpression: {
          facebookConnectionId: { $type: 'objectId' },
          status: { $in: ['ACTIVE', 'PAUSED', 'REVOKE_PENDING'] },
        },
        name: 'active_facebook_connection_binding',
      },
    );
    await installations.createIndex(
      { status: 1, lastHeartbeat: -1 },
      { name: 'status_lastHeartbeat' },
    );

    const indexes = await installations.indexes();
    const legacyIndex = indexes.find((index) =>
      index.name === 'clerkUserId_1_extensionInstanceId_1',
    );
    if (legacyIndex?.name) await installations.dropIndex(legacyIndex.name);

    console.log('Lifecycle fields backfilled and indexes ensured.');
  }
} finally {
  await mongoose.disconnect();
}
