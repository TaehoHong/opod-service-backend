import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
const migration = readFileSync(
  join(__dirname, "../drizzle/20261019042242_influencers/migration.sql"),
  "utf8",
);
const legacy = readFileSync(
  join(
    __dirname,
    "../drizzle/20261019002237_character_reference_links/migration.sql",
  ),
  "utf8",
);
describe("influencer migration", () => {
  let client: Client;
  let first: string;
  let second: string;
  beforeEach(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");
    await client.query(
      "DROP TABLE opod.character_influencers, opod.influencer_media, opod.influencers",
    );
    await client.query(legacy);
    first = randomUUID();
    second = randomUUID();
    await client.query(
      "INSERT INTO opod.characters(id,public_id,display_name,bio,updated_at) VALUES ($1,$2,'A','',now()),($3,$4,'B','',now())",
      [first, first, second, second],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
    await client.end();
  });
  it("merges account aliases, preserves every character mapping and removes the old table", async () => {
    await client.query(
      "INSERT INTO opod.character_reference_links(character_id,url) VALUES ($1,'https://www.instagram.com/Example/'),($1,'https://instagram.com/example/?x=1'),($2,'https://www.instagram.com/example/')",
      [first, second],
    );
    await client.query(migration);
    const accounts = await client.query(
      "SELECT id,platform,username,url,pg_typeof(id)::text AS type FROM opod.influencers",
    );
    expect(accounts.rows).toEqual([
      {
        id: expect.any(String),
        platform: "instagram",
        username: "example",
        url: "https://www.instagram.com/example/",
        type: "bigint",
      },
    ]);
    expect(
      (
        await client.query(
          "SELECT character_id FROM opod.character_influencers ORDER BY character_id",
        )
      ).rows.map((r) => r.character_id),
    ).toEqual([first, second].sort());
    expect(
      (
        await client.query(
          "SELECT to_regclass('opod.character_reference_links') AS old",
        )
      ).rows[0].old,
    ).toBeNull();
    await client.query("DELETE FROM opod.characters WHERE id=$1", [first]);
    expect(
      (await client.query("SELECT count(*)::int AS n FROM opod.influencers"))
        .rows[0].n,
    ).toBe(1);
  });
  it("aborts unsupported post URLs without losing legacy data", async () => {
    await client.query(
      "INSERT INTO opod.character_reference_links(character_id,url) VALUES ($1,'https://www.instagram.com/p/ABC/')",
      [first],
    );
    await client.query("SAVEPOINT before_migration");
    await expect(client.query(migration)).rejects.toThrow(
      "Unsupported reference URL",
    );
    await client.query("ROLLBACK TO SAVEPOINT before_migration");
    expect(
      (await client.query("SELECT url FROM opod.character_reference_links"))
        .rows,
    ).toEqual([{ url: "https://www.instagram.com/p/ABC/" }]);
    expect(
      (
        await client.query(
          "SELECT to_regclass('opod.influencers') AS new_table",
        )
      ).rows[0].new_table,
    ).toBeNull();
  });
});
