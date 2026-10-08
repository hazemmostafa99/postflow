import 'dotenv/config';
import mongoose from 'mongoose';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const argumentsProvided = process.argv.slice(2);
if (argumentsProvided.includes('--help')) {
  console.log(
    'Usage: node scripts/migrate-publishing-platform.mjs (--report-only | --apply)',
  );
  process.exit(0);
}

const reportOnly = argumentsProvided.includes('--report-only');
const applyChanges = argumentsProvided.includes('--apply');
if (reportOnly === applyChanges) {
  throw new Error('Choose exactly one mode: --report-only or --apply.');
}

function definedFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

await mongoose.connect(databaseUrl);

try {
  const database = mongoose.connection.db;
  const jobs = database.collection('publishingjobs');
  const facebookConnections = database.collection('facebookconnections');
  const platformConnections = database.collection('platformconnections');

  const [jobDocuments, facebookDocuments, platformDocuments] =
    await Promise.all([
      jobs
        .find(
          {},
          {
            projection: {
              platform: 1,
              targetType: 1,
              facebookConnectionId: 1,
              platformConnectionId: 1,
            },
          },
        )
        .toArray(),
      facebookConnections.find({}).toArray(),
      platformConnections.find({}).toArray(),
    ]);

  const knownPlatforms = new Set(['FACEBOOK', 'INSTAGRAM', 'TIKTOK']);
  const missingJobPlatforms = jobDocuments.filter(
    (job) => job.platform === undefined || job.platform === null,
  );
  const unknownJobPlatforms = jobDocuments.filter(
    (job) => job.platform != null && !knownPlatforms.has(job.platform),
  );

  const platformByLegacyFacebookId = new Map();
  const duplicateLegacyMappings = [];
  for (const connection of platformDocuments) {
    if (!connection.legacyFacebookConnectionId) continue;
    const key = String(connection.legacyFacebookConnectionId);
    if (platformByLegacyFacebookId.has(key)) {
      duplicateLegacyMappings.push({
        facebookConnectionId: key,
        platformConnectionIds: [
          String(platformByLegacyFacebookId.get(key)._id),
          String(connection._id),
        ],
      });
      continue;
    }
    platformByLegacyFacebookId.set(key, connection);
  }

  const missingFacebookConnectionMappings = facebookDocuments.filter(
    (connection) => !platformByLegacyFacebookId.has(String(connection._id)),
  );

  const activeBindingCandidates = new Map();
  for (const connection of facebookDocuments) {
    if (!connection.activeExtensionInstallationId || connection.archivedAt)
      continue;
    const key = `${String(connection.activeExtensionInstallationId)}:FACEBOOK`;
    const candidates = activeBindingCandidates.get(key) ?? [];
    candidates.push(String(connection._id));
    activeBindingCandidates.set(key, candidates);
  }
  const duplicateActiveBindings = [...activeBindingCandidates.entries()]
    .filter(([, connectionIds]) => connectionIds.length > 1)
    .map(([binding, connectionIds]) => ({ binding, connectionIds }));

  const facebookJobsMissingGenericOwner = jobDocuments.filter(
    (job) =>
      job.facebookConnectionId &&
      !job.platformConnectionId &&
      (job.platform === undefined ||
        job.platform === null ||
        job.platform === 'FACEBOOK'),
  );

  console.log(`Mode: ${reportOnly ? 'REPORT ONLY' : 'APPLY'}.`);
  console.log(`Publishing jobs inspected: ${jobDocuments.length}.`);
  console.log(`Jobs missing platform: ${missingJobPlatforms.length}.`);
  console.log(`Jobs with unknown platform: ${unknownJobPlatforms.length}.`);
  console.log(`Facebook connections inspected: ${facebookDocuments.length}.`);
  console.log(`Platform connections inspected: ${platformDocuments.length}.`);
  console.log(
    `Facebook connections requiring a compatibility mapping: ${missingFacebookConnectionMappings.length}.`,
  );
  console.log(
    `Facebook jobs requiring a generic owner link: ${facebookJobsMissingGenericOwner.length}.`,
  );
  console.log(
    `Duplicate legacy Facebook mappings: ${duplicateLegacyMappings.length}.`,
  );
  console.log(
    `Duplicate active installation/platform bindings: ${duplicateActiveBindings.length}.`,
  );

  if (unknownJobPlatforms.length > 0) {
    console.log(
      'Unknown job platform sample:',
      unknownJobPlatforms.slice(0, 10).map((job) => ({
        jobId: String(job._id),
        platform: job.platform,
      })),
    );
  }
  if (duplicateLegacyMappings.length > 0) {
    console.log(
      'Duplicate legacy mapping sample:',
      duplicateLegacyMappings.slice(0, 10),
    );
  }
  if (duplicateActiveBindings.length > 0) {
    console.log(
      'Duplicate active binding sample:',
      duplicateActiveBindings.slice(0, 10),
    );
  }

  if (!reportOnly) {
    if (
      unknownJobPlatforms.length > 0 ||
      duplicateLegacyMappings.length > 0 ||
      duplicateActiveBindings.length > 0
    ) {
      throw new Error(
        'Resolve unknown platforms and duplicate connection mappings before applying the migration.',
      );
    }

    const now = new Date();
    // Only create PlatformConnections for non-archived Facebook connections.
    // Archived connections don't need active PlatformConnection records.
    const activeFacebookConnections = facebookDocuments.filter(
      (c) => !c.archivedAt,
    );
    for (const connection of activeFacebookConnections) {
      const copiedFields = definedFields({
        activeExtensionInstallationId: connection.activeExtensionInstallationId,
        displayName: connection.displayName,
        displayNameKey: connection.displayNameKey,
        externalAccountId: connection.facebookUserId,
        detectedExternalAccountId: connection.detectedFacebookUserId,
        status: connection.status ?? 'PENDING',
        workerStatus: connection.workerStatus ?? 'OFFLINE',
        sessionDetected: connection.facebookSessionDetected === true,
        lastSeenAt: connection.lastSeenAt ?? connection.updatedAt ?? now,
        archivedAt: connection.archivedAt,
        archivedByClerkUserId: connection.archivedByClerkUserId,
        archiveReason: connection.archiveReason,
        updatedAt: now,
      });

      await platformConnections.updateOne(
        { legacyFacebookConnectionId: connection._id },
        {
          $setOnInsert: {
            clerkUserId: connection.clerkUserId,
            platform: 'FACEBOOK',
            legacyFacebookConnectionId: connection._id,
            createdAt: connection.createdAt ?? now,
          },
          $set: copiedFields,
        },
        { upsert: true },
      );
    }

    // For archived Facebook connections, create a minimal PlatformConnection
    // without externalAccountId to preserve the legacy mapping without
    // violating the unique user_platform_external_account index.
    const archivedFacebookConnections = facebookDocuments.filter(
      (c) => c.archivedAt,
    );
    for (const connection of archivedFacebookConnections) {
      await platformConnections.updateOne(
        { legacyFacebookConnectionId: connection._id },
        {
          $setOnInsert: {
            clerkUserId: connection.clerkUserId,
            platform: 'FACEBOOK',
            legacyFacebookConnectionId: connection._id,
            createdAt: connection.createdAt ?? now,
            status: connection.status ?? 'PENDING',
            workerStatus: 'OFFLINE',
            archivedAt: connection.archivedAt,
            archivedByClerkUserId: connection.archivedByClerkUserId,
            archiveReason: connection.archiveReason,
          },
          $set: {
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }

    await jobs.updateMany(
      { $or: [{ platform: { $exists: false } }, { platform: null }] },
      { $set: { platform: 'FACEBOOK' } },
    );

    const migratedPlatformConnections = await platformConnections
      .find(
        { legacyFacebookConnectionId: { $type: 'objectId' } },
        { projection: { legacyFacebookConnectionId: 1 } },
      )
      .toArray();

    for (const connection of migratedPlatformConnections) {
      await jobs.updateMany(
        {
          facebookConnectionId: connection.legacyFacebookConnectionId,
          $or: [
            { platformConnectionId: { $exists: false } },
            { platformConnectionId: null },
          ],
        },
        {
          $set: {
            platform: 'FACEBOOK',
            platformConnectionId: connection._id,
          },
        },
      );
    }

    // Indexes are defined in the PlatformConnection and PublishingJob schemas.
    // Mongoose will create them on application startup.

    console.log(
      'Platform fields, Facebook compatibility mappings, and job ownership links were applied. Indexes will be created by Mongoose on startup.',
    );
  }
} finally {
  await mongoose.disconnect();
}
