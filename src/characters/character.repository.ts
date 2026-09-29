import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { DatabaseTransactionContext } from "../core/database/database-transaction-context";
import { CharacterActivityContext } from "../character-social/character-social.types";

type DbRow = Record<string, unknown>;

@Injectable()
export class CharacterRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  async withActivityTransaction<T>(
    characterId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const active = this.transactions.current();
    if (active) {
      if (active.characterId !== characterId) {
        throw new Error(
          "nested character activity transactions must use the same character",
        );
      }
      return work();
    }
    return this.database.client.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`character_social:${characterId}`}, 0))`,
      );
      return this.transactions.run(transaction, characterId, work);
    });
  }

  async findActivityContext(
    characterId: string,
    now: Date,
  ): Promise<CharacterActivityContext | null> {
    const client = this.transactions.require();
    const result = await client.execute(sql`
      SELECT status, timezone, interests,
             EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name=c.timezone) AS valid_timezone,
             CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name=c.timezone)
               THEN (${now}::timestamptz AT TIME ZONE c.timezone)::time::text END AS local_time,
             CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name=c.timezone)
               THEN (date_trunc('day', ${now}::timestamptz AT TIME ZONE c.timezone) AT TIME ZONE c.timezone) END AS day_start,
             CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name=c.timezone)
               THEN ((date_trunc('day', ${now}::timestamptz AT TIME ZONE c.timezone) + interval '1 day') AT TIME ZONE c.timezone) END AS day_end
      FROM opod.characters c WHERE id=${characterId}
    `);
    const row = result.rows[0] as DbRow | undefined;
    if (!row) return null;
    return {
      status: String(row.status),
      timezone: row.timezone ? String(row.timezone) : null,
      validTimezone: Boolean(row.valid_timezone),
      localTime: row.local_time ? String(row.local_time) : null,
      dayStart: row.day_start ? new Date(String(row.day_start)) : null,
      dayEnd: row.day_end ? new Date(String(row.day_end)) : null,
      interests: Array.isArray(row.interests)
        ? row.interests.map((value) => String(value))
        : [],
    };
  }

  async findActiveIds(characterIds: string[]): Promise<Set<string>> {
    if (characterIds.length === 0) return new Set();
    const rows = await this.transactions.require().execute(sql`
      SELECT id FROM opod.characters
      WHERE id IN ${sql`(${sql.join(
        characterIds.map((id) => sql`${id}`),
        sql`, `,
      )})`}
        AND status='active'
    `);
    return new Set((rows.rows as DbRow[]).map((row) => String(row.id)));
  }
}
