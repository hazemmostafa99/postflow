import 'dotenv/config';
import mongoose from 'mongoose';

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
    const result = await jobs.updateOne(
      { _id: job._id, ...unownedJobFilter },
      { $set: { facebookConnectionId: group.facebookConnectionId } },
    );
    if (result.modifiedCount === 1) migrated += 1;
  }

  console.log(`Migrated ${migrated} publishing jobs to Facebook connections.`);
  console.log(`Skipped ${skipped} legacy jobs whose groups have no connection.`);
  console.log(`Groups still without a Facebook connection: ${unownedGroups}.`);
  if (unresolvedJobIds.length) {
    console.log('Sample unresolved publishing job IDs:', unresolvedJobIds.join(', '));
  }
} finally {
  await mongoose.disconnect();
}
