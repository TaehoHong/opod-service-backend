import { Inject, Injectable } from "@nestjs/common";
import { CharacterService } from "../characters/character.service";
import { PostService } from "../posts/post.service";
import { PostReactionService } from "../posts/post-reaction.service";
import { CharacterFollowService } from "./character-follow.service";
import { CharacterPostViewService } from "./character-post-view.service";
import { CharacterSocialActivityJobService } from "./character-social-activity-job.service";
import { CharacterSocialActivityPolicyService } from "./character-social-activity-policy.service";
import {
  CHARACTER_SOCIAL_WORKER_OPTIONS,
  CharacterSocialWorkerOptions,
} from "./character-social.options";
import { CharacterSocialActivityClaim } from "./character-social.types";

@Injectable()
export class CharacterSocialActivityApplicationService {
  constructor(
    private readonly characters: CharacterService,
    private readonly posts: PostService,
    private readonly reactions: PostReactionService,
    private readonly views: CharacterPostViewService,
    private readonly follows: CharacterFollowService,
    private readonly policies: CharacterSocialActivityPolicyService,
    private readonly jobs: CharacterSocialActivityJobService,
    @Inject(CHARACTER_SOCIAL_WORKER_OPTIONS)
    private readonly options: CharacterSocialWorkerOptions,
  ) {}

  async scheduleDueActivities(inputNow?: Date): Promise<number> {
    const now = inputNow ?? new Date();
    const characterIds = await this.policies.findDueCharacterIds(
      now,
      this.options.batchSize,
    );
    let scheduled = 0;
    for (const characterId of characterIds) {
      const inserted = await this.characters.withActivityTransaction(
        characterId,
        async () => {
          const policy = await this.policies.lockDue(characterId, now);
          if (!policy) return false;
          await this.policies.advance(
            characterId,
            now,
            policy.activityIntervalMinutes,
          );
          const context = await this.characters.findActivityContext(
            characterId,
            now,
          );
          if (!this.policies.canAct(policy, context)) {
            return false;
          }
          return this.jobs.schedule(characterId, now);
        },
      );
      if (inserted) scheduled += 1;
    }
    return scheduled;
  }

  async processNextActivity(inputNow?: Date): Promise<boolean> {
    const claim = await this.jobs.claimNext(inputNow);
    if (!claim) return false;
    try {
      await this.processClaimedActivity(claim, inputNow);
    } catch (error) {
      await this.jobs.failJob(claim, inputNow, error);
      throw error;
    }
    return true;
  }

  async processClaimedActivity(
    claim: CharacterSocialActivityClaim,
    inputNow?: Date,
  ): Promise<boolean> {
    return this.characters.withActivityTransaction(
      claim.characterId,
      async () => {
        const now = inputNow ?? new Date();
        if (!(await this.jobs.hasLiveLease(claim, now))) return false;
        const policy = await this.policies.findForExecution(claim.characterId);
        const context = await this.characters.findActivityContext(
          claim.characterId,
          now,
        );
        if (!policy || !this.policies.canAct(policy, context)) {
          return this.jobs.cancel(claim, inputNow ?? new Date());
        }

        const usedViews = await this.views.countDaily(
          claim.characterId,
          context.dayStart,
          context.dayEnd,
        );
        const usedLikes = await this.reactions.countDailyLikes(
          claim.characterId,
          context.dayStart,
          context.dayEnd,
        );
        const usedFollows = await this.follows.countDaily(
          claim.characterId,
          context.dayStart,
          context.dayEnd,
        );
        const allowances = this.policies.remainingAllowances(
          policy,
          { views: usedViews, likes: usedLikes, follows: usedFollows },
          this.options.postsPerRun,
        );
        const candidates = await this.posts.findSocialCandidates({
          characterId: claim.characterId,
          interests: context.interests,
          now,
          limit: allowances.views,
        });
        const viewedPostIds = await this.views.record(
          claim.characterId,
          candidates,
          now,
        );
        await this.reactions.likeViewedPosts({
          characterId: claim.characterId,
          postIds: viewedPostIds,
          probability: policy.postLikeProbability,
          limit: allowances.likes,
          now,
        });
        await this.follows.followQualifiedAuthors({
          characterId: claim.characterId,
          threshold: this.options.minDistinctLikedPostsToFollow,
          limit: allowances.follows,
          now,
        });
        if (!(await this.jobs.complete(claim, inputNow ?? new Date()))) {
          throw new Error("character social lease expired before completion");
        }
        return true;
      },
    );
  }
}
