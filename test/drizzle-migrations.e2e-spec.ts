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
const embeddingMigrationName = "20260831073322_add_qwen_embeddings";
const contextMigrationName = "20260908093302_persist_character_context";
const integratedContextMigrationName = "20260911063302_character_chat_context";
const canonSourcesMigrationName = "20260911074900_character_canon_sources";
const chatMemorySchemaMigrationName =
  "20260913111235_chat_memory_schema_clarity";
const personaSchemaV2MigrationName = "20260916062345_persona_schema_v2";
const characterSocialMigrationName = "20260918053849_character_social_activity";

function runMigrations(databaseUrl: string, ...arguments_: string[]): string {
  return execFileSync(process.execPath, [migrationScript, ...arguments_], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
}

describe("Drizzle migrations", () => {
  it("enforces prompt content, required model references, revisions and deletion restriction", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let modelId: string | undefined;
    try {
      const created = await client.query(
        "INSERT INTO opod.ai_models(type,provider,model) VALUES('llm','openai-compatible','test') RETURNING id",
      );
      modelId = created.rows[0].id;
      await expect(
        client.query(
          "INSERT INTO opod.post_agent_prompts(stage,revision,system_prompt,output_schema) VALUES('post_plan',1,'prompt','{}')",
        ),
      ).rejects.toMatchObject({ code: "23502" });
      await expect(
        client.query(
          "INSERT INTO opod.post_agent_prompts(stage,revision,ai_model_id,system_prompt,output_schema) VALUES('post_plan',1,$1,'','{}')",
          [modelId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          "INSERT INTO opod.post_agent_prompts(stage,revision,ai_model_id,system_prompt,output_schema) VALUES('generation',1,$1,'prompt','{}')",
          [modelId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query(
        "INSERT INTO opod.post_agent_prompts(stage,revision,ai_model_id,system_prompt,output_schema,model) VALUES('post_plan',1,$1,'prompt','{}',NULL)",
        [modelId],
      );
      await expect(
        client.query(
          "INSERT INTO opod.post_agent_prompts(stage,revision,ai_model_id,system_prompt,output_schema) VALUES('post_plan',1,$1,'prompt','{}')",
          [modelId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query("DELETE FROM opod.ai_models WHERE id=$1", [modelId]),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      if (modelId) {
        await client.query(
          "DELETE FROM opod.post_agent_prompts WHERE ai_model_id=$1",
          [modelId],
        );
        await client.query("DELETE FROM opod.ai_models WHERE id=$1", [modelId]);
      }
      await client.end();
    }
  });
  it("applies the baseline and records its seed data on a blank database", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");

    const migrationUrl = new URL(databaseUrl);
    migrationUrl.searchParams.set("options", "-c search_path=opod");
    expect(runMigrations(migrationUrl.toString())).toContain(
      "Drizzle migrations are up to date",
    );

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const baseline = await client.query(
        "SELECT name, hash FROM drizzle.__drizzle_migrations WHERE name = $1",
        [baselineName],
      );
      expect(baseline.rows).toEqual([
        { name: baselineName, hash: baselineHash },
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
      await client.query(`
        ALTER TYPE opod.generation_job_status RENAME TO generation_job_status_old;
        CREATE TYPE opod.generation_job_status AS ENUM ('queued', 'running', 'completed', 'failed', 'draft');
        ALTER TABLE opod.generation_jobs ALTER COLUMN status DROP DEFAULT;
        ALTER TABLE opod.generation_jobs ALTER COLUMN status TYPE opod.generation_job_status USING status::text::opod.generation_job_status;
        ALTER TABLE opod.generation_jobs ALTER COLUMN status SET DEFAULT 'queued';
        DROP TYPE opod.generation_job_status_old;
      `);

      const searchPathUrl = new URL(databaseUrl);
      searchPathUrl.searchParams.set("options", "-c search_path=opod,public");
      expect(runMigrations(searchPathUrl.toString(), "--baseline")).toContain(
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

  it("fails invalid reaction upgrades without cleanup, then preserves valid history", async () => {
    const container = await new PostgreSqlContainer(
      "pgvector/pgvector:0.8.6-pg16",
    )
      .withDatabase("ai_sns_invalid_history")
      .withUsername("ai_sns")
      .withPassword("ai_sns")
      .start();
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    try {
      for (const migrationName of [
        baselineName,
        embeddingMigrationName,
        contextMigrationName,
        integratedContextMigrationName,
        canonSourcesMigrationName,
        chatMemorySchemaMigrationName,
        personaSchemaV2MigrationName,
      ]) {
        await client.query(
          readFileSync(
            join(projectRoot, "drizzle", migrationName, "migration.sql"),
            "utf8",
          ),
        );
      }

      const characterId = randomUUID();
      const userId = randomUUID();
      const postId = randomUUID();
      await client.query(
        "INSERT INTO opod.characters(id,public_id,display_name,bio,updated_at) VALUES($1,$2,'Legacy','',now())",
        [characterId, `legacy-${characterId}`],
      );
      await client.query(
        "INSERT INTO opod.users(id,display_name) VALUES($1,'Legacy')",
        [userId],
      );
      await client.query(
        "INSERT INTO opod.posts(id,character_id,content) VALUES($1,$2,'legacy')",
        [postId, characterId],
      );
      await client.query(
        `INSERT INTO opod.post_reactions(id,post_id,user_id,character_id,reaction_type)
         VALUES($1,$2,$3,$4,'like')`,
        [randomUUID(), postId, userId, characterId],
      );

      await expect(
        client.query(
          readFileSync(
            join(
              projectRoot,
              "drizzle",
              characterSocialMigrationName,
              "migration.sql",
            ),
            "utf8",
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await client.query(
            "SELECT user_id,character_id FROM opod.post_reactions WHERE post_id=$1",
            [postId],
          )
        ).rows,
      ).toEqual([{ user_id: userId, character_id: characterId }]);
      expect(
        (
          await client.query(
            `SELECT to_regclass('opod.character_social_activity_jobs') AS jobs,
                    EXISTS (
                      SELECT 1 FROM information_schema.columns
                      WHERE table_schema='opod' AND table_name='characters'
                        AND column_name='timezone'
                    ) AS has_timezone`,
          )
        ).rows,
      ).toEqual([{ jobs: null, has_timezone: false }]);

      await client.query(
        "UPDATE opod.post_reactions SET user_id=NULL WHERE post_id=$1",
        [postId],
      );
      const duplicateReactionId = randomUUID();
      await client.query(
        `INSERT INTO opod.post_reactions(id,post_id,character_id,reaction_type)
         VALUES($1,$2,$3,'like')`,
        [duplicateReactionId, postId, characterId],
      );
      await expect(
        client.query(
          readFileSync(
            join(
              projectRoot,
              "drizzle",
              characterSocialMigrationName,
              "migration.sql",
            ),
            "utf8",
          ),
        ),
      ).rejects.toMatchObject({ code: "23505" });
      expect(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM opod.post_reactions WHERE post_id=$1",
            [postId],
          )
        ).rows,
      ).toEqual([{ count: 2 }]);

      await client.query("DELETE FROM opod.post_reactions WHERE id=$1", [
        duplicateReactionId,
      ]);
      await client.query(
        readFileSync(
          join(
            projectRoot,
            "drizzle",
            characterSocialMigrationName,
            "migration.sql",
          ),
          "utf8",
        ),
      );
      expect(
        (
          await client.query(
            `SELECT c.timezone,r.id,r.character_id,r.user_id
               FROM opod.characters c
               JOIN opod.post_reactions r ON r.character_id=c.id
              WHERE c.id=$1`,
            [characterId],
          )
        ).rows,
      ).toEqual([
        {
          timezone: null,
          id: expect.any(String),
          character_id: characterId,
          user_id: null,
        },
      ]);
    } finally {
      await client.end().catch(() => undefined);
      await container.stop();
    }
  });
});
