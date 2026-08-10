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
// 답변 워커의 자동 tick은 끈다. 켜두면 모든 e2e가 백그라운드에서 작업을 집어
// 무엇이 무엇을 만들었는지가 흐려진다. 워커를 검증하는 스펙은 runOnce를 직접
// 부른다.
process.env.MESSAGE_REPLY_WORKER_ENABLED = "false";
