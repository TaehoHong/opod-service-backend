import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CharacterService } from "../characters/character.service";
import {
  CHARACTER_SOCIAL_WORKER_OPTIONS,
  CharacterSocialWorkerOptions,
} from "./character-social.options";
import { CharacterSocialActivityJobRepository } from "./character-social-activity-job.repository";
import { CharacterSocialActivityClaim } from "./character-social.types";

@Injectable()
export class CharacterSocialActivityJobService {
  constructor(
    private readonly repository: CharacterSocialActivityJobRepository,
    private readonly characters: CharacterService,
    @Inject(CHARACTER_SOCIAL_WORKER_OPTIONS)
    private readonly options: CharacterSocialWorkerOptions,
  ) {}

  schedule(characterId: string, now: Date) {
    return this.repository.insert(characterId, now);
  }

  async claimNext(
    inputNow?: Date,
  ): Promise<CharacterSocialActivityClaim | null> {
    const candidateNow = inputNow ?? new Date();
    const candidates = await this.repository.findClaimCandidates(
      candidateNow,
      this.options.batchSize,
    );
    for (const candidate of candidates) {
      const claim = await this.characters.withActivityTransaction(
        candidate.characterId,
        async () => {
          const now = inputNow ?? new Date();
          const job = await this.repository.lock(candidate.id);
          if (!job) return null;
          const eligible =
            (job.status === "queued" && job.nextAttemptAt <= now) ||
            (job.status === "running" &&
              job.leaseExpiresAt !== null &&
              job.leaseExpiresAt <= now);
          if (!eligible) return null;
          if (job.attemptCount >= this.options.maxAttempts) {
            await this.repository.markAttemptsExhausted(candidate.id, now);
            return null;
          }
          const leaseToken = randomUUID();
          const attemptCount = await this.repository.assignLease({
            id: candidate.id,
            leaseToken,
            leaseExpiresAt: new Date(now.getTime() + this.options.leaseMs),
            now,
          });
          return { ...candidate, leaseToken, attemptCount };
        },
      );
      if (claim) return claim;
    }
    return null;
  }

  hasLiveLease(claim: CharacterSocialActivityClaim, now: Date) {
    return this.repository.hasLiveLease(claim, now);
  }

  complete(claim: CharacterSocialActivityClaim, now: Date) {
    return this.repository.finish(claim, now, "completed");
  }

  cancel(claim: CharacterSocialActivityClaim, now: Date) {
    return this.repository.finish(claim, now, "cancelled");
  }

  async failJob(
    claim: CharacterSocialActivityClaim,
    inputNow: Date | undefined,
    error: unknown,
  ): Promise<boolean> {
    return this.characters.withActivityTransaction(claim.characterId, () => {
      const now = inputNow ?? new Date();
      return this.repository.fail({
        claim,
        now,
        terminal: claim.attemptCount >= this.options.maxAttempts,
        retryAt: new Date(now.getTime() + this.options.retryBackoffMs),
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
