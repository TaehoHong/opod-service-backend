import { Injectable } from "@nestjs/common";
import { CharacterSocialActivityPolicyRepository } from "./character-social-activity-policy.repository";
import { CharacterActivityContext } from "./character-social.types";
import { CharacterSocialActivityPolicy } from "./character-social-activity-policy.repository";

@Injectable()
export class CharacterSocialActivityPolicyService {
  constructor(
    private readonly repository: CharacterSocialActivityPolicyRepository,
  ) {}

  findDueCharacterIds(now: Date, limit: number) {
    return this.repository.findDueCharacterIds(now, limit);
  }
  lockDue(characterId: string, now: Date) {
    return this.repository.lockDue(characterId, now);
  }
  findForExecution(characterId: string) {
    return this.repository.findForExecution(characterId);
  }
  advance(characterId: string, now: Date, intervalMinutes: number) {
    return this.repository.advance(
      characterId,
      now,
      new Date(now.getTime() + intervalMinutes * 60_000),
    );
  }

  isInWindow(localTime: string | null, start: string, end: string): boolean {
    if (!localTime) return false;
    return start < end
      ? localTime >= start && localTime < end
      : localTime >= start || localTime < end;
  }

  canAct(
    policy: CharacterSocialActivityPolicy | null,
    context: CharacterActivityContext | null,
  ): context is CharacterActivityContext & {
    dayStart: Date;
    dayEnd: Date;
  } {
    return Boolean(
      policy?.enabled &&
      context &&
      context.status === "active" &&
      context.timezone &&
      context.validTimezone &&
      context.dayStart &&
      context.dayEnd &&
      this.isInWindow(
        context.localTime,
        policy.activeStartLocalTime,
        policy.activeEndLocalTime,
      ),
    );
  }

  remainingAllowances(
    policy: CharacterSocialActivityPolicy,
    used: { views: number; likes: number; follows: number },
    postsPerRun: number,
  ) {
    return {
      views: Math.min(
        postsPerRun,
        Math.max(0, policy.maxDailyPostViews - used.views),
      ),
      likes: Math.max(0, policy.maxDailyPostLikes - used.likes),
      follows: Math.max(0, policy.maxDailyFollows - used.follows),
    };
  }
}
