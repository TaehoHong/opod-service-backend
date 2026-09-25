import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { DatabaseTransactionContext } from "../database/database-transaction-context";

type DbRow = Record<string, unknown>;

export type CharacterSocialActivityPolicy = {
  characterId: string;
  enabled: boolean;
  activeStartLocalTime: string;
  activeEndLocalTime: string;
  activityIntervalMinutes: number;
  maxDailyPostViews: number;
  maxDailyPostLikes: number;
  maxDailyFollows: number;
  postLikeProbability: number;
};

@Injectable()
export class CharacterSocialActivityPolicyRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  async findDueCharacterIds(now: Date, limit: number): Promise<string[]> {
    const result = await this.database.client.execute(sql`
      SELECT character_id FROM opod.character_social_activity_policies
      WHERE enabled AND next_activity_at<=${now}
      ORDER BY next_activity_at, character_id LIMIT ${limit}
    `);
    return (result.rows as DbRow[]).map((row) => String(row.character_id));
  }

  async lockDue(characterId: string, now: Date) {
    const result = await this.transactions.require().execute(sql`
      SELECT character_id, enabled, active_start_local_time, active_end_local_time,
             activity_interval_minutes, max_daily_post_views, max_daily_post_likes,
             max_daily_follows, post_like_probability
      FROM opod.character_social_activity_policies
      WHERE character_id=${characterId} AND enabled AND next_activity_at<=${now}
      FOR UPDATE
    `);
    return this.map(result.rows[0] as DbRow | undefined);
  }

  async findForExecution(characterId: string) {
    const result = await this.transactions.require().execute(sql`
      SELECT character_id, enabled, active_start_local_time, active_end_local_time,
             activity_interval_minutes, max_daily_post_views, max_daily_post_likes,
             max_daily_follows, post_like_probability
      FROM opod.character_social_activity_policies
      WHERE character_id=${characterId} FOR UPDATE
    `);
    return this.map(result.rows[0] as DbRow | undefined);
  }

  async advance(characterId: string, now: Date, nextActivityAt: Date) {
    await this.transactions.require().execute(sql`
      UPDATE opod.character_social_activity_policies
      SET next_activity_at=${nextActivityAt},
          updated_at=${now}
      WHERE character_id=${characterId}
    `);
  }

  private map(row: DbRow | undefined): CharacterSocialActivityPolicy | null {
    if (!row) return null;
    return {
      characterId: String(row.character_id),
      enabled: Boolean(row.enabled),
      activeStartLocalTime: String(row.active_start_local_time),
      activeEndLocalTime: String(row.active_end_local_time),
      activityIntervalMinutes: Number(row.activity_interval_minutes),
      maxDailyPostViews: Number(row.max_daily_post_views),
      maxDailyPostLikes: Number(row.max_daily_post_likes),
      maxDailyFollows: Number(row.max_daily_follows),
      postLikeProbability: Number(row.post_like_probability),
    };
  }
}
