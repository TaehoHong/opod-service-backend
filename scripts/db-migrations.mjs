import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

const { Client } = pg;

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsFolder = join(projectRoot, "drizzle");
const baselineName = "20260831062118_baseline";
const baselineHash =
  "b9a479b5aac45c7f633e3749f561b6eff6c80c9eb01a60c4410f67b49def3350";
const migrationConfig = {
  migrationsFolder,
  migrationsSchema: "drizzle",
  migrationsTable: "__drizzle_migrations",
};
const lockName = "opod-drizzle-migrations-v1";

function truncateIdentifier(value) {
  let result = value;
  while (Buffer.byteLength(result) > 63) {
    result = result.slice(0, -1);
  }
  return result;
}

function key(value) {
  return JSON.stringify(value);
}

function compareSets(label, expectedValues, actualValues) {
  const expected = new Set(expectedValues.map(key));
  const actual = new Set(actualValues.map(key));
  const missing = [...expected].filter((value) => !actual.has(value));
  const unexpected = [...actual].filter((value) => !expected.has(value));

  if (missing.length === 0 && unexpected.length === 0) return;

  const detail = [
    missing.length > 0 ? `missing=${missing.slice(0, 5).join(", ")}` : null,
    unexpected.length > 0
      ? `unexpected=${unexpected.slice(0, 5).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("; ");
  throw new Error(`Baseline preflight failed (${label}): ${detail}`);
}

function expectedColumnType(column) {
  const baseType = column.type === "bigserial" ? "bigint" : column.type;
  const qualifiedType = column.typeSchema
    ? `${column.typeSchema}.${baseType}`
    : baseType;
  return `${qualifiedType}${"[]".repeat(column.dimensions)}`;
}

function expectedEntities(snapshot, entityType) {
  return Object.values(snapshot.ddl).filter(
    (entity) => entity.entityType === entityType,
  );
}

async function assertNoRecordedDrizzleMigrations(client) {
  const { rows } = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation",
  );
  if (!rows[0].relation) return;

  const migrationRows = await client.query(
    "SELECT name FROM drizzle.__drizzle_migrations ORDER BY id",
  );
  if (migrationRows.rowCount > 0) {
    throw new Error(
      `Drizzle migration metadata already exists: ${migrationRows.rows
        .map((row) => row.name ?? "<unnamed>")
        .join(", ")}`,
    );
  }
}

async function assertLegacyMigrationsComplete(client) {
  for (const schema of ["opod", "public"]) {
    const relationName = `${schema}._prisma_migrations`;
    const { rows } = await client.query(
      "SELECT to_regclass($1)::text AS relation",
      [relationName],
    );
    if (!rows[0].relation) continue;

    const result = await client.query(
      `SELECT migration_name
         FROM ${schema}._prisma_migrations
        WHERE finished_at IS NULL AND rolled_back_at IS NULL
        ORDER BY started_at`,
    );
    if (result.rowCount > 0) {
      throw new Error(
        `Unfinished legacy migrations exist in ${relationName}: ${result.rows
          .map((row) => row.migration_name)
          .join(", ")}`,
      );
    }
  }
}

async function assertBaselineSchema(client, snapshot) {
  const expectedTables = expectedEntities(snapshot, "tables").map((table) => [
    table.name,
    table.isRlsEnabled,
  ]);
  const actualTables = await client.query(`
    SELECT c.relname AS name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'opod'
       AND c.relkind IN ('r', 'p')
       AND c.relname <> '_prisma_migrations'
     ORDER BY c.relname
  `);
  compareSets(
    "tables",
    expectedTables,
    actualTables.rows.map((row) => [row.name, row.rls_enabled]),
  );

  const expectedColumns = expectedEntities(snapshot, "columns").map(
    (column) => [
      column.table,
      column.name,
      expectedColumnType(column),
      column.notNull,
    ],
  );
  const actualColumns = await client.query(`
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           CASE
             WHEN tn.nspname = 'opod' THEN tn.nspname || '.' || t.typname
             ELSE format_type(a.atttypid, a.atttypmod)
           END AS data_type,
           a.attnotnull AS not_null
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_namespace tn ON tn.oid = t.typnamespace
     WHERE n.nspname = 'opod'
       AND c.relkind IN ('r', 'p')
       AND c.relname <> '_prisma_migrations'
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum
  `);
  compareSets(
    "columns",
    expectedColumns,
    actualColumns.rows.map((row) => [
      row.table_name,
      row.column_name,
      row.data_type,
      row.not_null,
    ]),
  );

  const expectedEnums = expectedEntities(snapshot, "enums").map((enumType) => [
    enumType.name,
    enumType.values,
  ]);
  const actualEnums = await client.query(`
    SELECT t.typname AS name,
           array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE n.nspname = 'opod'
     GROUP BY t.typname
     ORDER BY t.typname
  `);
  compareSets(
    "enums",
    expectedEnums,
    actualEnums.rows.map((row) => [row.name, row.values]),
  );

  const expectedIndexes = expectedEntities(snapshot, "indexes").map((index) => [
    index.table,
    truncateIdentifier(index.name),
    index.isUnique,
  ]);
  const actualIndexes = await client.query(`
    SELECT source.relname AS table_name,
           target.relname AS index_name,
           idx.indisunique AS is_unique
      FROM pg_index idx
      JOIN pg_class source ON source.oid = idx.indrelid
      JOIN pg_class target ON target.oid = idx.indexrelid
      JOIN pg_namespace n ON n.oid = source.relnamespace
     WHERE n.nspname = 'opod'
       AND source.relname <> '_prisma_migrations'
       AND NOT idx.indisprimary
     ORDER BY source.relname, target.relname
  `);
  compareSets(
    "indexes",
    expectedIndexes,
    actualIndexes.rows.map((row) => [
      row.table_name,
      row.index_name,
      row.is_unique,
    ]),
  );

  const constraints = await client.query(`
    SELECT con.contype AS constraint_type,
           con.conname AS name,
           source.relname AS table_name,
           ARRAY(
             SELECT a.attname::text
               FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, position)
               JOIN pg_attribute a
                 ON a.attrelid = con.conrelid AND a.attnum = key.attnum
              ORDER BY key.position
           ) AS columns,
           target.relname AS target_table,
           ARRAY(
             SELECT a.attname::text
               FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, position)
               JOIN pg_attribute a
                 ON a.attrelid = con.confrelid AND a.attnum = key.attnum
              ORDER BY key.position
           ) AS target_columns,
           CASE con.confupdtype
             WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
           END AS on_update,
           CASE con.confdeltype
             WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
           END AS on_delete
      FROM pg_constraint con
      JOIN pg_class source ON source.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = source.relnamespace
      LEFT JOIN pg_class target ON target.oid = con.confrelid
     WHERE n.nspname = 'opod'
       AND source.relname <> '_prisma_migrations'
       AND con.contype IN ('p', 'f', 'c')
     ORDER BY con.contype, source.relname, con.conname
  `);

  const expectedPrimaryKeys = expectedEntities(snapshot, "pks").map(
    (primaryKey) => [
      primaryKey.table,
      truncateIdentifier(primaryKey.name),
      primaryKey.columns,
    ],
  );
  compareSets(
    "primary keys",
    expectedPrimaryKeys,
    constraints.rows
      .filter((constraint) => constraint.constraint_type === "p")
      .map((constraint) => [
        constraint.table_name,
        constraint.name,
        constraint.columns,
      ]),
  );

  const expectedForeignKeys = expectedEntities(snapshot, "fks").map(
    (foreignKey) => [
      foreignKey.table,
      truncateIdentifier(foreignKey.name),
      foreignKey.columns,
      foreignKey.tableTo,
      foreignKey.columnsTo,
      foreignKey.onUpdate,
      foreignKey.onDelete,
    ],
  );
  compareSets(
    "foreign keys",
    expectedForeignKeys,
    constraints.rows
      .filter((constraint) => constraint.constraint_type === "f")
      .map((constraint) => [
        constraint.table_name,
        constraint.name,
        constraint.columns,
        constraint.target_table,
        constraint.target_columns,
        constraint.on_update,
        constraint.on_delete,
      ]),
  );

  const expectedChecks = expectedEntities(snapshot, "checks").map((check) => [
    check.table,
    truncateIdentifier(check.name),
  ]);
  compareSets(
    "checks",
    expectedChecks,
    constraints.rows
      .filter((constraint) => constraint.constraint_type === "c")
      .map((constraint) => [constraint.table_name, constraint.name]),
  );
}

async function assertBaselineSeeds(client) {
  const productCodes = [
    "credits_500",
    "credits_1050",
    "credits_3300",
    "credits_5750",
  ];
  const creditProducts = await client.query(
    `
    SELECT code
      FROM opod.credit_products
     WHERE code = ANY($1::text[])
     ORDER BY code
  `,
    [productCodes],
  );
  compareSets(
    "credit product seeds",
    productCodes,
    creditProducts.rows.map((row) => row.code),
  );

  const mappings = await client.query(
    `
    SELECT provider_product_id
      FROM opod.payment_product_mappings
     WHERE channel = 'web'
       AND provider = 'local'
       AND environment = 'development'
       AND provider_product_id = ANY($1::text[])
     ORDER BY provider_product_id
  `,
    [productCodes],
  );
  compareSets(
    "payment mapping seeds",
    productCodes,
    mappings.rows.map((row) => row.provider_product_id),
  );
}

async function registerBaseline(client, baseline) {
  await client.query("BEGIN");
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint,
        name text,
        applied_at timestamp with time zone DEFAULT now()
      )
    `);
    const existing = await client.query(
      "SELECT name FROM drizzle.__drizzle_migrations ORDER BY id FOR UPDATE",
    );
    if (existing.rowCount > 0) {
      throw new Error("Drizzle migration metadata was created concurrently");
    }
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at, name)
       VALUES ($1, $2, $3)`,
      [baseline.hash, baseline.folderMillis, baseline.name],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const baselineMode = process.argv.slice(2).includes("--baseline");
  const unknownArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== "--baseline");
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown arguments: ${unknownArguments.join(", ")}`);
  }

  const migrations = readMigrationFiles(migrationConfig);
  const baseline = migrations.find(
    (migration) => migration.name === baselineName,
  );
  if (!baseline || baseline.hash !== baselineHash) {
    throw new Error("The approved Drizzle baseline is missing or modified");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    const database = drizzle({ client });

    if (!baselineMode) {
      await migrate(database, migrationConfig);
      console.log("Drizzle migrations are up to date");
      return;
    }

    const snapshot = JSON.parse(
      await readFile(
        join(migrationsFolder, baselineName, "snapshot.json"),
        "utf8",
      ),
    );
    await assertNoRecordedDrizzleMigrations(client);
    await assertLegacyMigrationsComplete(client);
    await assertBaselineSchema(client, snapshot);
    await assertBaselineSeeds(client);
    await registerBaseline(client, baseline);
    console.log(`Registered existing schema as ${baselineName}`);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [lockName])
      .catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
