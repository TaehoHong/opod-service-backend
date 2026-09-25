import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { DatabaseTransactionContext } from "../database/database-transaction-context";
import { CharacterSocialActivityClaim } from "./character-social.types";

type DbRow = Record<string, unknown>;

@Injectable()
export class CharacterSocialActivityJobRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  async insert(characterId: string, now: Date): Promise<boolean> {
    const result = await this.transactions.require().execute(sql`
      INSERT INTO opod.character_social_activity_jobs(character_id, scheduled_at, next_attempt_at)
      VALUES (${characterId}, ${now}, ${now}) ON CONFLICT DO NOTHING RETURNING id
    `);
    return result.rows.length > 0;
  }

  async findClaimCandidates(now: Date, limit: number) {
    const result = await this.database.client.execute(sql`
      SELECT id, character_id FROM opod.character_social_activity_jobs
      WHERE (processing_status='queued' AND next_attempt_at<=${now})
         OR (processing_status='running' AND processing_lease_expires_at<=${now})
      ORDER BY next_attempt_at, id LIMIT ${limit}
    `);
    return (result.rows as DbRow[]).map((row) => ({
      id: BigInt(String(row.id)),
      characterId: String(row.character_id),
    }));
  }

  async lock(id: bigint): Promise<{
    attemptCount: number;
    status: string;
    leaseExpiresAt: Date | null;
    nextAttemptAt: Date;
  } | null> {
    const client = this.transactions.require();
    const current = await client.execute(sql`
      SELECT attempt_count, processing_status, processing_lease_expires_at, next_attempt_at
      FROM opod.character_social_activity_jobs WHERE id=${id} FOR UPDATE
    `);
    const job = current.rows[0] as DbRow | undefined;
    if (!job) return null;
    return {
      attemptCount: Number(job.attempt_count),
      status: String(job.processing_status),
      leaseExpiresAt: job.processing_lease_expires_at
        ? new Date(String(job.processing_lease_expires_at))
        : null,
      nextAttemptAt: new Date(String(job.next_attempt_at)),
    };
  }

  async markAttemptsExhausted(id: bigint, now: Date) {
    await this.transactions.require().execute(sql`
        UPDATE opod.character_social_activity_jobs
        SET processing_status='failed', processing_lease_token=NULL,
            processing_lease_expires_at=NULL, finished_at=${now}, updated_at=${now},
            last_error_message='maximum attempts exhausted after lease expiry'
        WHERE id=${id}
      `);
  }

  async assignLease(input: {
    id: bigint;
    leaseToken: string;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<number> {
    const updated = await this.transactions.require().execute(sql`
      UPDATE opod.character_social_activity_jobs
      SET processing_status='running', attempt_count=attempt_count+1,
          processing_lease_token=${input.leaseToken},
          processing_lease_expires_at=${input.leaseExpiresAt},
          updated_at=${input.now}
      WHERE id=${input.id} RETURNING attempt_count
    `);
    return Number((updated.rows[0] as DbRow).attempt_count);
  }

  async hasLiveLease(claim: CharacterSocialActivityClaim, now: Date) {
    const result = await this.transactions.require().execute(sql`
      SELECT id FROM opod.character_social_activity_jobs
      WHERE id=${claim.id} AND character_id=${claim.characterId}
        AND processing_status='running' AND processing_lease_token=${claim.leaseToken}
        AND processing_lease_expires_at>${now} FOR UPDATE
    `);
    return result.rows.length > 0;
  }

  async finish(
    claim: CharacterSocialActivityClaim,
    now: Date,
    status: "completed" | "cancelled",
  ) {
    const result = await this.transactions.require().execute(sql`
      UPDATE opod.character_social_activity_jobs
      SET processing_status=${status}, processing_lease_token=NULL,
          processing_lease_expires_at=NULL, finished_at=${now}, updated_at=${now},
          last_error_message=NULL
      WHERE id=${claim.id} AND processing_status='running'
        AND processing_lease_token=${claim.leaseToken}
        AND processing_lease_expires_at>${now}
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async fail(input: {
    claim: CharacterSocialActivityClaim;
    now: Date;
    terminal: boolean;
    retryAt: Date;
    message: string;
  }) {
    const result = await this.transactions.require().execute(sql`
      UPDATE opod.character_social_activity_jobs
      SET processing_status=${input.terminal ? "failed" : "queued"},
          processing_lease_token=NULL, processing_lease_expires_at=NULL,
          next_attempt_at=${input.retryAt}, finished_at=${input.terminal ? input.now : null},
          last_error_message=${input.message.slice(0, 2000)}, updated_at=${input.now}
      WHERE id=${input.claim.id} AND processing_status='running'
        AND processing_lease_token=${input.claim.leaseToken}
        AND processing_lease_expires_at>${input.now}
      RETURNING id
    `);
    return result.rows.length > 0;
  }
}
