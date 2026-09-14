import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";

const projectRoot = join(__dirname, "..");
const migrationScript = join(projectRoot, "scripts", "db-migrations.mjs");
const baselineName = "20260831062118_baseline";
const baselineHash =
  "b9a479b5aac45c7f633e3749f561b6eff6c80c9eb01a60c4410f67b49def3350";
const embeddingMigrationName = "20260831073322_add_qwen_embeddings";
const embeddingMigrationHash =
  "e65b3cc84d831f090f0e0994e498edd6e6219ea0e27a3b5aa40f7ae6ee58ca2c";
const contextMigrationName = "20260908093302_persist_character_context";
const integratedContextMigrationName = "20260911063302_character_chat_context";
const canonSourcesMigrationName = "20260911074900_character_canon_sources";
const chatMemorySchemaMigrationName =
  "20260913111235_chat_memory_schema_clarity";
const chatMemorySchemaMigrationHash = createHash("sha256")
  .update(
    readFileSync(
      join(
        projectRoot,
        "drizzle",
        chatMemorySchemaMigrationName,
        "migration.sql",
      ),
    ),
  )
  .digest("hex");
const canonSourcesMigrationHash = createHash("sha256")
  .update(
    readFileSync(
      join(projectRoot, "drizzle", canonSourcesMigrationName, "migration.sql"),
    ),
  )
  .digest("hex");
const integratedContextMigrationHash = createHash("sha256")
  .update(
    readFileSync(
      join(
        projectRoot,
        "drizzle",
        integratedContextMigrationName,
        "migration.sql",
      ),
    ),
  )
  .digest("hex");
const contextMigrationHash = createHash("sha256")
  .update(
    readFileSync(
      join(projectRoot, "drizzle", contextMigrationName, "migration.sql"),
    ),
  )
  .digest("hex");

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
        { name: embeddingMigrationName, hash: embeddingMigrationHash },
        { name: contextMigrationName, hash: contextMigrationHash },
        {
          name: integratedContextMigrationName,
          hash: integratedContextMigrationHash,
        },
        { name: canonSourcesMigrationName, hash: canonSourcesMigrationHash },
        {
          name: chatMemorySchemaMigrationName,
          hash: chatMemorySchemaMigrationHash,
        },
      ]);

      const extension = await client.query(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
      );
      expect(extension.rows).toEqual([{ extversion: "0.8.6" }]);

      const embeddingColumns = await client.query(`
        SELECT c.relname AS table_name,
               format_type(a.atttypid, a.atttypmod) AS data_type,
               a.attnotnull AS not_null
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'opod'
           AND c.relname IN (
             'character_canon_memories',
             'character_visual_profile_references',
             'character_location_references'
           )
           AND a.attname IN ('embedding', 'canon_embedding')
         ORDER BY c.relname
      `);
      expect(embeddingColumns.rows).toEqual([
        {
          table_name: "character_canon_memories",
          data_type: "vector(1024)",
          not_null: false,
        },
        {
          table_name: "character_location_references",
          data_type: "vector(1024)",
          not_null: false,
        },
        {
          table_name: "character_visual_profile_references",
          data_type: "vector(1024)",
          not_null: false,
        },
      ]);

      const undocumentedSchemaObjects = await client.query(`
        WITH target_tables(table_name) AS (
          VALUES
            ('chat_conversations'),
            ('chat_messages'),
            ('chat_reply_generation_jobs'),
            ('chat_memory_entries'),
            ('chat_memory_consolidation_jobs'),
            ('chat_applied_state_changes'),
            ('chat_relationship_states'),
            ('chat_memory_session_summaries'),
            ('character_canon_memories')
        )
        SELECT c.relname AS object_name
          FROM target_tables target
          JOIN pg_namespace n ON n.nspname = 'opod'
          JOIN pg_class c ON c.relnamespace = n.oid
                         AND c.relname = target.table_name
         WHERE obj_description(c.oid, 'pg_class') IS NULL
        UNION ALL
        SELECT c.relname || '.' || a.attname
          FROM target_tables target
          JOIN pg_namespace n ON n.nspname = 'opod'
          JOIN pg_class c ON c.relnamespace = n.oid
                         AND c.relname = target.table_name
          JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE a.attnum > 0 AND NOT a.attisdropped
           AND col_description(c.oid, a.attnum) IS NULL
        UNION ALL
        SELECT t.typname
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'opod'
           AND t.typname IN (
             'chat_message_sender_role',
             'chat_reply_generation_job_status',
             'chat_memory_derivation_type',
             'chat_memory_context_injection_mode',
             'chat_memory_consolidation_job_status'
           )
           AND obj_description(t.oid, 'pg_type') IS NULL
      `);
      expect(undocumentedSchemaObjects.rows).toEqual([]);

      const legacyNames = await client.query(`
        SELECT relname AS name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'opod'
           AND relname ~ '^(agent_|message_conversations|message_reply_jobs|messages_pkey|character_memories)'
        UNION ALL
        SELECT conname
          FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = 'opod'
           AND conname ~ '^(agent_|message_conversations|message_reply_jobs|messages_pkey|character_memories)'
      `);
      expect(legacyNames.rows).toEqual([]);

      const dimensions = await client.query(
        "SELECT vector_dims(array_fill(0::real, ARRAY[1024])::vector) AS dimensions",
      );
      expect(dimensions.rows).toEqual([{ dimensions: 1024 }]);

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
    const container = await new PostgreSqlContainer(
      "pgvector/pgvector:0.8.6-pg16",
    )
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
      await client.query(
        `INSERT INTO opod.agent_core_memories
           (user_id, character_id, content, updated_at)
         VALUES ('legacy-user', 'legacy-character', '사용자는 이름을 민지라고 알려줬다.', now())`,
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
      expect(metadata.rows[0].count).toBe(6);
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

      const migratedCore = await client.query(
        `SELECT memory_text, memory_category, context_injection_mode
           FROM opod.chat_memory_entries
          WHERE user_id = 'legacy-user'
            AND character_id = 'legacy-character'`,
      );
      expect(migratedCore.rows).toEqual([
        {
          memory_text: "사용자는 이름을 민지라고 알려줬다.",
          memory_category: "interpretation",
          context_injection_mode: "always",
        },
      ]);

      const comments = await client.query(
        `SELECT obj_description('opod.chat_memory_entries'::regclass) AS table_comment,
                col_description(
                  'opod.chat_memory_entries'::regclass,
                  (SELECT attnum FROM pg_attribute
                    WHERE attrelid = 'opod.chat_memory_entries'::regclass
                      AND attname = 'memory_text')
                ) AS column_comment`,
      );
      expect(comments.rows[0].table_comment).toContain("장기 기억");
      expect(comments.rows[0].column_comment).toContain("메모리 문장");
    } finally {
      await client.end().catch(() => undefined);
      await container.stop();
    }
  });
});
