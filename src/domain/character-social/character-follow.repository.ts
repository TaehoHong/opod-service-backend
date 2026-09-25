import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseTransactionContext } from "../database/database-transaction-context";

type DbRow = Record<string, unknown>;

@Injectable()
export class CharacterFollowRepository {
  constructor(private readonly transactions: DatabaseTransactionContext) {}

  async count(characterId: string, dayStart: Date, dayEnd: Date) {
    const result = await this.transactions.require().execute(sql`
      SELECT count(*) AS count FROM opod.character_follows
      WHERE follower_character_id=${characterId}
        AND followed_at>=${dayStart} AND followed_at<${dayEnd}
    `);
    return Number((result.rows[0] as DbRow).count);
  }

  async findExisting(characterId: string, authorIds: string[]) {
    if (authorIds.length === 0) return new Set<string>();
    const result = await this.transactions.require().execute(sql`
      SELECT followed_character_id FROM opod.character_follows
      WHERE follower_character_id=${characterId}
        AND followed_character_id IN
          ${sql`(${sql.join(
            authorIds.map((id) => sql`${id}`),
            sql`, `,
          )})`}
    `);
    return new Set(
      (result.rows as DbRow[]).map((row) => String(row.followed_character_id)),
    );
  }

  async insert(characterId: string, authorIds: string[], now: Date) {
    if (authorIds.length === 0) return;
    await this.transactions.require().execute(sql`
      INSERT INTO opod.character_follows(follower_character_id, followed_character_id, followed_at)
      VALUES ${sql.join(
        authorIds.map((authorId) => sql`(${characterId}, ${authorId}, ${now})`),
        sql`, `,
      )}
      ON CONFLICT DO NOTHING
    `);
  }
}
