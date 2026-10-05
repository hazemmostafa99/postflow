import 'dotenv/config';
import mongoose from 'mongoose';

const supportedArguments = new Set(['--apply', '--report-only', '--help']);
const argumentsProvided = process.argv.slice(2);
const unknownArguments = argumentsProvided.filter(
  (argument) => !supportedArguments.has(argument),
);

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
}

if (argumentsProvided.includes('--help')) {
  console.log(
    'Usage: node scripts/migrate-connection-ownership.mjs (--report-only | --apply)',
  );
  process.exit(0);
}

const reportOnly = argumentsProvided.includes('--report-only');
const applyChanges = argumentsProvided.includes('--apply');
if (reportOnly === applyChanges) {
  throw new Error('Choose exactly one mode: --report-only or --apply.');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

await mongoose.connect(databaseUrl);

try {
  const database = mongoose.connection.db;
  const groups = database.collection('groups');
  const jobs = database.collection('publishingjobs');
  const unownedGroupFilter = {
    $or: [
      { facebookConnectionId: { $exists: false } },
      { facebookConnectionId: null },
    ],
  };
  const unownedJobFilter = {
    $or: [
      { facebookConnectionId: { $exists: false } },
      { facebookConnectionId: null },
    ],
  };
  const unownedGroups = await groups.countDocuments(unownedGroupFilter);
  const cursor = jobs.find(unownedJobFilter);
  let eligible = 0;
  let migrated = 0;
  let skipped = 0;
  const unresolvedJobIds = [];

  for await (const job of cursor) {
    const group = await groups.findOne(
      { _id: job.groupId },
      { projection: { facebookConnectionId: 1 } },
    );
    if (!group?.facebookConnectionId) {
      skipped += 1;
      if (unresolvedJobIds.length < 20) unresolvedJobIds.push(String(job._id));
      continue;
    }
    eligible += 1;
    if (reportOnly) continue;
    const result = await jobs.updateOne(
      { _id: job._id, ...unownedJobFilter },
      { $set: { facebookConnectionId: group.facebookConnectionId } },
    );
    if (result.modifiedCount === 1) migrated += 1;
  }

  console.log(`Mode: ${reportOnly ? 'REPORT ONLY (no writes)' : 'APPLY'}.`);
  if (reportOnly) {
    console.log(
      `${eligible} publishing jobs can be assigned from their Group connection.`,
    );
  } else {
    console.log(
      `Migrated ${migrated} of ${eligible} eligible publishing jobs to Facebook connections.`,
    );
  }
  console.log(`Skipped ${skipped} legacy jobs whose groups have no connection.`);
  console.log(`Groups still without a Facebook connection: ${unownedGroups}.`);
  if (unresolvedJobIds.length) {
    console.log('Sample unresolved publishing job IDs:', unresolvedJobIds.join(', '));
  }
} finally {
  await mongoose.disconnect();
}
