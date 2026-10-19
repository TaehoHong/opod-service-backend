import { randomUUID } from "node:crypto";
import { Client } from "pg";

describe("character reference link schema", () => {
  it("generates BIGINT IDs, isolates uniqueness by character and cascades physical deletion", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const first = randomUUID();
    const second = randomUUID();
    await client.connect();
    try {
      await client.query(
        "INSERT INTO opod.characters(id, public_id, display_name, bio, updated_at) VALUES ($1,$3,'Reference test','',now()),($2,$4,'Other reference test','',now())",
        [first, second, `reference-${first}`, `reference-${second}`],
      );
      const created = await client.query(
        "INSERT INTO opod.character_reference_links(character_id,url) VALUES ($1,'https://example.com/motif') RETURNING id, pg_typeof(id)::text AS type",
        [first],
      );
      expect(created.rows).toEqual([
        { id: expect.stringMatching(/^[1-9][0-9]*$/), type: "bigint" },
      ]);
      await expect(
        client.query(
          "INSERT INTO opod.character_reference_links(character_id,url) VALUES ($1,'https://example.com/motif')",
          [first],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query(
        "INSERT INTO opod.character_reference_links(character_id,url) VALUES ($1,'https://example.com/motif')",
        [second],
      );
      await expect(
        client.query(
          "INSERT INTO opod.character_reference_links(character_id,url) VALUES ($1,'https://example.com/orphan')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await client.query("DELETE FROM opod.characters WHERE id=$1", [first]);
      expect(
        (
          await client.query(
            "SELECT character_id FROM opod.character_reference_links WHERE character_id=ANY($1::uuid[])",
            [[first, second]],
          )
        ).rows,
      ).toEqual([{ character_id: second }]);
    } finally {
      await client.query(
        "DELETE FROM opod.characters WHERE id=ANY($1::uuid[])",
        [[first, second]],
      );
      await client.end();
    }
  });
});
