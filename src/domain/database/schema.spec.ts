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

    expect(tableConfigs).toHaveLength(63);
    expect(enums).toHaveLength(28);
    expect(columns).toHaveLength(552);
    expect(
      tableConfigs.reduce((count, table) => count + table.indexes.length, 0),
    ).toBe(120);
    expect(
      tableConfigs.reduce(
        (count, table) => count + table.foreignKeys.length,
        0,
      ),
    ).toBe(68);
    expect(new Set(tableConfigs.map((table) => table.schema))).toEqual(
      new Set(["opod"]),
    );
    expect(tableConfigs.map((table) => table.name)).not.toContain(
      "_prisma_migrations",
    );
  });

  it("preserves UUIDv7 and updatedAt client-side behavior", () => {
    const uuidPrimaryKeys = columns.filter(
      ({ column }) => column.primary && column.columnType === "PgUUID",
    );
    const updatedAtColumns = columns.filter(
      ({ column }) => column.name === "updated_at",
    );

    expect(uuidPrimaryKeys).toHaveLength(46);
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
      "generation_job_outputs_filter_preset_check",
      "unsettled_credit_debts_paid_debt_check",
    ]);
  });
});
