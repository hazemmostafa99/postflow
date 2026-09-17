import "dotenv/config";
import mongoose from "mongoose";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith("--")) args.set(value.slice(2), process.argv[index + 1]);
}

const email = (args.get("email") || process.env.ADMIN_EMAIL || "").trim().replaceAll("\\@", "@").toLowerCase();
const password = args.get("password") || process.env.ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid email with --email or ADMIN_EMAIL.");
if (!password || password.length < 8) throw new Error("Provide an 8+ character password with ADMIN_PASSWORD or --password.");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!clerkSecretKey) throw new Error("CLERK_SECRET_KEY is required.");

const users = await mongoose.connect(databaseUrl).then((connection) => connection.connection.db.collection("users"));
const existing = await users.findOne({ email });
if (existing) {
  await mongoose.disconnect();
  throw new Error(`A PostFlow user already uses ${email}.`);
}

let clerkUserId;
try {
  const clerkResponse = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${clerkSecretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email_address: [email], password }),
  });
  const clerkBody = await clerkResponse.json();
  if (!clerkResponse.ok) throw new Error(`Clerk user creation failed (${clerkResponse.status}): ${clerkBody?.errors?.[0]?.message || "unknown error"}`);
  clerkUserId = clerkBody.id;

  await users.insertOne({
    clerkUserId,
    email,
    role: "ADMIN",
    status: "ACTIVE",
    teamId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`Created PostFlow Admin ${email} (${clerkUserId}).`);
} catch (error) {
  if (clerkUserId) {
    await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${clerkSecretKey}` },
    });
    console.error("Database creation failed; the Clerk user was removed during cleanup.");
  }
  throw error;
} finally {
  await mongoose.disconnect();
}
