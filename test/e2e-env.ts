import { readFileSync } from "node:fs";
import { join } from "node:path";

const envFile = JSON.parse(
  readFileSync(join(__dirname, ".tmp", "e2e-db.json"), "utf8"),
) as { DATABASE_URL?: string };

if (!envFile.DATABASE_URL) {
  throw new Error("Testcontainers DATABASE_URL was not created");
}

process.env.DATABASE_URL = envFile.DATABASE_URL;
process.env.AUTH_JWT_SECRET = "test-auth-secret";
process.env.ADULT_IDENTITY_HASH_SECRET = "test-adult-identity-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
process.env.OPOD_AGENT_URL = "http://127.0.0.1:1";
