import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const projectRoot = join(__dirname, "..");
const migrationScript = join(projectRoot, "scripts", "db-migrations.mjs");
const baselineName = "20260831062118_baseline";
const baselineHash =
  "b9a479b5aac45c7f633e3749f561b6eff6c80c9eb01a60c4410f67b49def3350";

function runMigrations(databaseUrl: string, ...arguments_: string[]): string {
  return execFileSync(process.execPath, [migrationScript, ...arguments_], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
}

describe("Drizzle migrations", () => {
  it("applies the baseline and records its seed data on a blank database", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");

    expect(runMigrations(databaseUrl)).toContain(
      "Drizzle migrations are up to date",
    );

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const migrations = await client.query(
        `SELECT name, hash
           FROM drizzle.__drizzle_migrations
          ORDER BY id`,
      );
      expect(migrations.rows).toEqual([
        { name: baselineName, hash: baselineHash },
      ]);

      const products = await client.query(`
        SELECT code
          FROM opod.credit_products
         WHERE code IN ('credits_500', 'credits_1050', 'credits_3300', 'credits_5750')
         ORDER BY code
      `);
      expect(products.rows.map((row) => row.code)).toEqual([
        "credits_1050",
        "credits_3300",
        "credits_500",
        "credits_5750",
      ]);

      const mappings = await client.query(`
        SELECT provider_product_id
          FROM opod.payment_product_mappings
         WHERE channel = 'web'
           AND provider = 'local'
           AND environment = 'development'
         ORDER BY provider_product_id
      `);
      expect(mappings.rows.map((row) => row.provider_product_id)).toEqual([
        "credits_1050",
        "credits_3300",
        "credits_500",
        "credits_5750",
      ]);
    } finally {
      await client.end();
    }
  });

  it("registers an identical legacy schema without replaying application DDL", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("ai_sns_legacy_test")
      .withUsername("ai_sns")
      .withPassword("ai_sns")
      .start();
    const databaseUrl = container.getConnectionUri();
    const client = new Client({ connectionString: databaseUrl });

    try {
      await client.connect();
      const migrationsDirectory = join(
        __dirname,
        "fixtures",
        "legacy-migrations",
      );
      const legacyMigrations = readdirSync(migrationsDirectory)
        .sort()
        .filter((directory) =>
          existsSync(join(migrationsDirectory, directory, "migration.sql")),
        );
      expect(legacyMigrations).toHaveLength(31);

      for (const directory of legacyMigrations) {
        await client.query(
          readFileSync(
            join(migrationsDirectory, directory, "migration.sql"),
            "utf8",
          ),
        );
      }

      await client.query(`
        CREATE TABLE opod._prisma_migrations (
          id varchar(36) PRIMARY KEY,
          checksum varchar(64) NOT NULL,
          finished_at timestamptz,
          migration_name varchar(255) NOT NULL,
          logs text,
          rolled_back_at timestamptz,
          started_at timestamptz NOT NULL DEFAULT now(),
          applied_steps_count integer NOT NULL DEFAULT 0
        )
      `);
      for (const migration of legacyMigrations) {
        await client.query(
          `INSERT INTO opod._prisma_migrations
             (id, checksum, finished_at, migration_name, applied_steps_count)
           VALUES ($1, $2, now(), $3, 1)`,
          [randomUUID(), "legacy-test-checksum", migration],
        );
      }
      await client.query(
        `INSERT INTO opod.admin_settings (key, value, updated_at)
         VALUES ('drizzle_baseline_sentinel', 'preserved', now())`,
      );

      expect(runMigrations(databaseUrl, "--baseline")).toContain(
        `Registered existing schema as ${baselineName}`,
      );

      const registered = await client.query(
        `SELECT name, hash
           FROM drizzle.__drizzle_migrations
          ORDER BY id`,
      );
      expect(registered.rows).toEqual([
        { name: baselineName, hash: baselineHash },
      ]);
      expect(runMigrations(databaseUrl)).toContain(
        "Drizzle migrations are up to date",
      );

      const metadata = await client.query(
        "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations",
      );
      expect(metadata.rows[0].count).toBe(1);
      const legacyMetadata = await client.query(
        "SELECT count(*)::integer AS count FROM opod._prisma_migrations",
      );
      expect(legacyMetadata.rows[0].count).toBe(31);
      const sentinel = await client.query(
        `SELECT value
           FROM opod.admin_settings
          WHERE key = 'drizzle_baseline_sentinel'`,
      );
      expect(sentinel.rows).toEqual([{ value: "preserved" }]);
    } finally {
      await client.end().catch(() => undefined);
      await container.stop();
    }
  });
});
