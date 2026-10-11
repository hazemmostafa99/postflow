import 'dotenv/config';
import mongoose from 'mongoose';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const argumentsProvided = process.argv.slice(2);
if (argumentsProvided.includes('--help')) {
  console.log(
    'Usage: node scripts/migrate-extension-name-uniqueness.mjs (--report-only | --apply)',
  );
  process.exit(0);
}
const reportOnly = argumentsProvided.includes('--report-only');
const applyChanges = argumentsProvided.includes('--apply');
if (reportOnly === applyChanges) {
  throw new Error('Choose exactly one mode: --report-only or --apply.');
}

function normalizeName(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function keyFor(value) {
  return normalizeName(value).toLowerCase();
}

function withSuffix(base, suffixNumber) {
  const suffix = ` (${suffixNumber})`;
  return `${base.slice(0, Math.max(1, 60 - suffix.length)).trim()}${suffix}`;
}

await mongoose.connect(databaseUrl);

try {
  const connections = mongoose.connection.db.collection('facebookconnections');
  const usedNamesByUser = new Map();
  let updated = 0;
  let renamedDuplicates = 0;

  const cursor = connections.find({ displayName: { $type: 'string' } }).sort({
    clerkUserId: 1,
    createdAt: 1,
    _id: 1,
  });

  for await (const connection of cursor) {
    const normalized = normalizeName(connection.displayName);
    if (!normalized) {
      if (applyChanges) {
        await connections.updateOne(
          { _id: connection._id },
          { $unset: { displayName: 1, displayNameKey: 1 } },
        );
      }
      updated += 1;
      continue;
    }

    const usedNames = usedNamesByUser.get(connection.clerkUserId) ?? new Set();
    usedNamesByUser.set(connection.clerkUserId, usedNames);
    const base = normalized.slice(0, 60).trim();
    let candidate = base;
    let suffixNumber = 2;
    while (usedNames.has(keyFor(candidate))) {
      candidate = withSuffix(base, suffixNumber);
      suffixNumber += 1;
    }
    if (candidate !== connection.displayName || connection.displayNameKey !== keyFor(candidate)) {
      if (applyChanges) {
        await connections.updateOne(
          { _id: connection._id },
          { $set: { displayName: candidate, displayNameKey: keyFor(candidate) } },
        );
      }
      updated += 1;
      if (candidate !== connection.displayName) renamedDuplicates += 1;
    }
    usedNames.add(keyFor(candidate));
  }

  if (applyChanges) {
    await connections.createIndex(
      { clerkUserId: 1, displayNameKey: 1 },
      {
        unique: true,
        partialFilterExpression: { displayNameKey: { $type: 'string' } },
        name: 'clerkUserId_1_displayNameKey_1',
      },
    );
  }

  console.log(`Mode: ${reportOnly ? 'REPORT ONLY' : 'APPLY'}.`);
  console.log(`Updated ${updated} connection names; renamed ${renamedDuplicates} duplicates.`);
  if (applyChanges) console.log('Ensured unique per-user extension-name index.');
} finally {
  await mongoose.disconnect();
}
