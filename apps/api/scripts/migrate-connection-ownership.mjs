import 'dotenv/config';
import mongoose from 'mongoose';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

await mongoose.connect(databaseUrl);

try {
  const database = mongoose.connection.db;
  const groups = database.collection('groups');
  const jobs = database.collection('publishingjobs');
  const cursor = jobs.find({ facebookConnectionId: { $exists: false } });
  let migrated = 0;
  let skipped = 0;

  for await (const job of cursor) {
    const group = await groups.findOne(
      { _id: job.groupId },
      { projection: { facebookConnectionId: 1 } },
    );
    if (!group?.facebookConnectionId) {
      skipped += 1;
      continue;
    }
    await jobs.updateOne(
      { _id: job._id, facebookConnectionId: { $exists: false } },
      { $set: { facebookConnectionId: group.facebookConnectionId } },
    );
    migrated += 1;
  }

  console.log(`Migrated ${migrated} publishing jobs to Facebook connections.`);
  console.log(`Skipped ${skipped} legacy jobs whose groups have no connection.`);
} finally {
  await mongoose.disconnect();
}
