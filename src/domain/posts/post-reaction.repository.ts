import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { v7 as createUuidV7 } from "uuid";
import { DatabaseTransactionContext } from "../database/database-transaction-context";
import { postReactions } from "../database/schema";

type DbRow = Record<string, unknown>;

@Injectable()
export class PostReactionRepository {
  constructor(private readonly transactions: DatabaseTransactionContext) {}

  async countLikes(
    characterId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<number> {
    const result = await this.transactions.require().execute(sql`
      SELECT count(*) AS count FROM opod.post_reactions
      WHERE character_id=${characterId} AND reaction_type='like'
        AND created_at>=${dayStart} AND created_at<${dayEnd}
    `);
    return Number((result.rows[0] as DbRow).count);
  }

  async insertLikes(
    characterId: string,
    postIds: string[],
    now: Date,
  ): Promise<void> {
    if (postIds.length === 0) return;
    await this.transactions
      .require()
      .insert(postReactions)
      .values(
        postIds.map((postId) => ({
          id: createUuidV7(),
          postId,
          characterId,
          userId: null,
          reactionType: "like" as const,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  async findLikedAuthorCounts(
    characterId: string,
    afterAuthorId: string | null,
    limit: number,
  ): Promise<Array<{ authorId: string; distinctPostCount: number }>> {
    if (limit <= 0) return [];
    const result = await this.transactions.require().execute(sql`
      SELECT p.character_id AS author_id, count(DISTINCT r.post_id) AS post_count
      FROM opod.post_reactions r
      JOIN opod.posts p ON p.id=r.post_id
      WHERE r.character_id=${characterId} AND r.reaction_type='like'
        AND p.character_id<>${characterId}
        AND (${afterAuthorId}::uuid IS NULL OR p.character_id>${afterAuthorId})
      GROUP BY p.character_id
      ORDER BY p.character_id
      LIMIT ${limit}
    `);
    return (result.rows as DbRow[]).map((row) => ({
      authorId: String(row.author_id),
      distinctPostCount: Number(row.post_count),
    }));
  }
}
