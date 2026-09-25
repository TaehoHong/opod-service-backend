import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseTransactionContext } from "../database/database-transaction-context";

type DbRow = Record<string, unknown>;

@Injectable()
export class CharacterPostViewRepository {
  constructor(private readonly transactions: DatabaseTransactionContext) {}

  async count(characterId: string, dayStart: Date, dayEnd: Date) {
    const result = await this.transactions.require().execute(sql`
      SELECT count(*) AS count FROM opod.character_post_views
      WHERE viewer_character_id=${characterId}
        AND first_viewed_at>=${dayStart} AND first_viewed_at<${dayEnd}
    `);
    return Number((result.rows[0] as DbRow).count);
  }

  async insert(characterId: string, postIds: string[], now: Date) {
    if (postIds.length === 0) return [];
    const result = await this.transactions.require().execute(sql`
      INSERT INTO opod.character_post_views(viewer_character_id, post_id, first_viewed_at)
      VALUES ${sql.join(
        postIds.map((postId) => sql`(${characterId}, ${postId}, ${now})`),
        sql`, `,
      )}
      ON CONFLICT DO NOTHING RETURNING post_id
    `);
    return (result.rows as DbRow[]).map((row) => String(row.post_id));
  }
}
