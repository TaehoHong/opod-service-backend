import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseTransactionContext } from "../database/database-transaction-context";

type DbRow = Record<string, unknown>;

@Injectable()
export class PostRepository {
  constructor(private readonly transactions: DatabaseTransactionContext) {}

  async findSocialCandidates(input: {
    characterId: string;
    interests: string[];
    now: Date;
    limit: number;
  }): Promise<string[]> {
    if (input.limit <= 0 || input.interests.length === 0) return [];
    const result = await this.transactions.require().execute(sql`
      SELECT DISTINCT p.id, p.created_at
      FROM opod.posts p
      JOIN opod.characters author ON author.id=p.character_id AND author.status='active'
      JOIN opod.post_hashtags ph ON ph.post_id=p.id
      JOIN opod.hashtags h ON h.id=ph.hashtag_id
      LEFT JOIN opod.character_post_views v
        ON v.viewer_character_id=${input.characterId} AND v.post_id=p.id
      WHERE lower(regexp_replace(btrim(h.name), '^#', '')) IN
        ${sql`(${sql.join(
          input.interests.map((name) => sql`${name}`),
          sql`, `,
        )})`}
        AND p.character_id<>${input.characterId}
        AND p.created_at<=${input.now}
        AND v.post_id IS NULL
      ORDER BY p.created_at DESC, p.id
      LIMIT ${input.limit}
    `);
    return (result.rows as DbRow[]).map((row) => String(row.id));
  }
}
