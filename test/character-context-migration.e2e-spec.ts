import { randomUUID } from "node:crypto";
import { Client } from "pg";

// Runs only on the disposable DB provisioned by the E2E global setup.
describe("character and chat memory schema", () => {
  it("protects canon provenance, event time, and persona links", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      const character = randomUUID();
      const persona = randomUUID();
      const fragment = randomUUID();
      const memory = randomUUID();
      await client.query(
        "INSERT INTO opod.characters(id,public_id,display_name,bio,updated_at) VALUES($1,$2,'Synthetic','',now())",
        [character, `canon-${character}`],
      );
      await client.query(
        "INSERT INTO opod.character_personas(id,character_id,title,content,updated_at) VALUES($1,$2,'source','unchanged',now())",
        [persona, character],
      );
      await client.query(
        "INSERT INTO opod.character_persona_fragments(id,persona_id,ordinal,content,kind,injection,updated_at) VALUES($1,$2,0,'unchanged','lore','never_prompt',now())",
        [fragment, persona],
      );
      await client.query(
        `INSERT INTO opod.character_canon_memories
           (id,character_id,canon_text,authoring_reason,temporal_kind,context_injection_mode,updated_at)
         VALUES($1,$2,'unchanged','source','event','retrieved',now())`,
        [memory, character],
      );
      expect(
        (
          await client.query(
            `SELECT source_references,event_time_label,event_time_precision
               FROM opod.character_canon_memories WHERE id=$1`,
            [memory],
          )
        ).rows,
      ).toEqual([
        {
          source_references: null,
          event_time_label: null,
          event_time_precision: null,
        },
      ]);

      for (const change of [
        "source_references='{}'",
        "event_time_precision='invented'",
        "event_time_label='2023-07'",
        "event_time_label='2023-07',event_time_precision='month',event_occurred_at=now()",
        "event_time_label='now',event_time_precision='instant'",
      ]) {
        await client.query("SAVEPOINT malformed");
        await expect(
          client.query(
            `UPDATE opod.character_canon_memories SET ${change} WHERE id=$1`,
            [memory],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT malformed");
      }

      await client.query(
        `UPDATE opod.character_canon_memories
            SET source_references='[]',event_time_label='2023-07',event_time_precision='month'
          WHERE id=$1`,
        [memory],
      );
      await client.query(
        "INSERT INTO opod.character_persona_canon_links(fragment_id,memory_id) VALUES($1,$2)",
        [fragment, memory],
      );
      await client.query("SAVEPOINT linked");
      await expect(
        client.query("DELETE FROM opod.character_canon_memories WHERE id=$1", [
          memory,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
      await client.query("ROLLBACK TO SAVEPOINT linked");
      await expect(
        client.query(
          "INSERT INTO opod.character_persona_canon_links(fragment_id,memory_id) VALUES($1,$2)",
          [fragment, memory],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });

  it("keeps legacy chat-memory metadata unknown and rejects malformed evidence", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      await client.query(
        `INSERT INTO opod.chat_memory_entries
           (id,user_id,character_id,memory_text,derivation_type,importance_score)
         VALUES ($1,'synthetic','synthetic','legacy','observation',1)`,
        [id],
      );
      const row = await client.query(
        `SELECT embedding_model,embedded_text_sha256,source_session_id,
                source_message_snapshots,memory_category,event_occurred_at,
                context_injection_mode
           FROM opod.chat_memory_entries WHERE id=$1`,
        [id],
      );
      expect(row.rows).toEqual([
        {
          embedding_model: null,
          embedded_text_sha256: null,
          source_session_id: null,
          source_message_snapshots: null,
          memory_category: null,
          event_occurred_at: null,
          context_injection_mode: "retrieved",
        },
      ]);

      for (const [field, value] of [
        ["source_message_snapshots", "{}"],
        ["memory_category", "invented"],
      ]) {
        await client.query("SAVEPOINT invalid_metadata");
        await expect(
          client.query(
            `UPDATE opod.chat_memory_entries SET ${field}=$2 WHERE id=$1`,
            [id, value],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT invalid_metadata");
      }
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
