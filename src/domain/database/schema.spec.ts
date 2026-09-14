import { is } from "drizzle-orm";
import { getTableConfig, isPgEnum, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

const schemaValues: unknown[] = Object.values(schema);
const tables = schemaValues.filter((value): value is PgTable =>
  is(value, PgTable),
);
const tableConfigs = tables.map((table) => getTableConfig(table));
const columns = tableConfigs.flatMap((table) =>
  table.columns.map((column) => ({
    column,
    path: `${table.name}.${column.name}`,
  })),
);

describe("Drizzle schema", () => {
  it("captures the complete application schema without the legacy migration table", () => {
    const enums = schemaValues.filter(isPgEnum);

    expect(tableConfigs).toHaveLength(64);
    expect(enums).toHaveLength(29);
    expect(columns).toHaveLength(586);
    expect(
      tableConfigs.reduce((count, table) => count + table.indexes.length, 0),
    ).toBe(121);
    expect(
      tableConfigs.reduce(
        (count, table) => count + table.foreignKeys.length,
        0,
      ),
    ).toBe(71);
    expect(new Set(tableConfigs.map((table) => table.schema))).toEqual(
      new Set(["opod"]),
    );
    expect(tableConfigs.map((table) => table.name)).not.toContain(
      "_prisma_migrations",
    );
    expect(tableConfigs.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "chat_conversations",
        "chat_messages",
        "chat_reply_generation_jobs",
        "chat_memory_entries",
        "chat_memory_consolidation_jobs",
        "chat_applied_state_changes",
        "chat_relationship_states",
        "chat_memory_session_summaries",
        "character_canon_memories",
      ]),
    );
    expect(tableConfigs.map((table) => table.name)).not.toEqual(
      expect.arrayContaining([
        "agent_core_memories",
        "agent_archival_memories",
        "message_conversations",
        "messages",
        "character_memories",
      ]),
    );
  });

  it("preserves UUIDv7 and updatedAt client-side behavior", () => {
    const uuidPrimaryKeys = columns.filter(
      ({ column }) => column.primary && column.columnType === "PgUUID",
    );
    const updatedAtColumns = columns.filter(
      ({ column }) => column.name === "updated_at",
    );

    expect(uuidPrimaryKeys).toHaveLength(47);
    for (const { column, path } of uuidPrimaryKeys) {
      expect({ defaultFn: column.defaultFn, path }).toEqual({
        defaultFn: expect.any(Function),
        path,
      });
      expect({ path, value: column.defaultFn?.() }).toEqual({
        path,
        value: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      });
    }

    expect(updatedAtColumns).toHaveLength(33);
    for (const { column, path } of updatedAtColumns) {
      expect({ onUpdateFn: column.onUpdateFn, path }).toEqual({
        onUpdateFn: expect.any(Function),
        path,
      });
      expect(column.onUpdateFn?.()).toBeInstanceOf(Date);
    }
  });

  it("keeps bigint values lossless and retains database checks", () => {
    const bigintColumns = columns.filter((column) =>
      ["PgBigInt64", "PgBigSerial64"].includes(column.column.columnType),
    );
    const checkNames = tableConfigs
      .flatMap((table) => table.checks)
      .map((check) => check.name)
      .sort();

    expect(bigintColumns.map(({ path }) => path).sort()).toEqual([
      "character_action_logs.id",
      "console_logs.id",
      "llm_log_media.llm_log_id",
      "llm_logs.id",
      "service_logs.id",
    ]);
    expect(checkNames).toEqual([
      "character_canon_memories_event_time_fields_check",
      "character_canon_memories_event_time_precision_check",
      "character_canon_memories_routing_check",
      "character_canon_memories_source_references_check",
      "character_persona_fragments_content_check",
      "character_persona_fragments_injection_check",
      "character_persona_fragments_kind_check",
      "character_persona_fragments_ordinal_check",
      "chat_memory_entries_memory_category_check",
      "chat_memory_entries_source_message_snapshots_check",
      "generation_job_outputs_filter_preset_check",
      "unsettled_credit_debts_paid_debt_check",
    ]);
  });

  it("stores 1024-dimensional embeddings for memory and reference captions", () => {
    const embeddingTables = [
      "character_canon_memories",
      "character_visual_profile_references",
      "character_location_references",
    ];

    for (const tableName of embeddingTables) {
      const table = tableConfigs.find((config) => config.name === tableName);
      const embedding = table?.columns.find((column) =>
        ["embedding", "canon_embedding"].includes(column.name),
      );

      expect({ tableName, columnType: embedding?.columnType }).toEqual({
        tableName,
        columnType: "PgVector",
      });
      expect({ tableName, sqlType: embedding?.getSQLType() }).toEqual({
        tableName,
        sqlType: "vector(1024)",
      });
      expect({ tableName, notNull: embedding?.notNull }).toEqual({
        tableName,
        notNull: false,
      });
      expect(table?.columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "embedding_model",
          tableName === "character_canon_memories"
            ? "embedding_generated_at"
            : "embedded_at",
        ]),
      );
    }
  });
});
