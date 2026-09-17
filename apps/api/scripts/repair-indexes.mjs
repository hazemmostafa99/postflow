import 'dotenv/config';
import mongoose from 'mongoose';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

await mongoose.connect(databaseUrl);

try {
  const groups = mongoose.connection.db.collection('groups');
  const indexes = await groups.indexes();
  const names = new Set(indexes.map((index) => index.name));

  if (names.has('userId_1_externalId_1')) {
    await groups.dropIndex('userId_1_externalId_1');
    console.log('Dropped legacy groups index: userId_1_externalId_1');
  } else {
    console.log('Legacy groups index not found: userId_1_externalId_1');
  }

  await groups.createIndex(
    { clerkUserId: 1, externalId: 1 },
    { unique: true, name: 'clerkUserId_1_externalId_1' },
  );
  console.log('Ensured groups index: clerkUserId_1_externalId_1');
} finally {
  await mongoose.disconnect();
}
