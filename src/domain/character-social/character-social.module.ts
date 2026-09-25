import { Module } from "@nestjs/common";
import { CharactersModule } from "../characters/characters.module";
import { DatabaseModule } from "../database/database.module";
import { PostsModule } from "../posts/posts.module";
import { CharacterFollowRepository } from "./character-follow.repository";
import { CharacterFollowService } from "./character-follow.service";
import { CharacterPostViewRepository } from "./character-post-view.repository";
import { CharacterPostViewService } from "./character-post-view.service";
import { CharacterSocialActivityApplicationService } from "./character-social-activity-application.service";
import { CharacterSocialActivityJobRepository } from "./character-social-activity-job.repository";
import { CharacterSocialActivityJobService } from "./character-social-activity-job.service";
import { CharacterSocialActivityPolicyRepository } from "./character-social-activity-policy.repository";
import { CharacterSocialActivityPolicyService } from "./character-social-activity-policy.service";
import {
  CHARACTER_SOCIAL_WORKER_OPTIONS,
  CharacterSocialWorker,
  characterSocialWorkerOptions,
} from "./character-social.worker";

@Module({
  imports: [DatabaseModule, CharactersModule, PostsModule],
  providers: [
    CharacterSocialWorker,
    CharacterSocialActivityApplicationService,
    CharacterSocialActivityPolicyRepository,
    CharacterSocialActivityPolicyService,
    CharacterSocialActivityJobRepository,
    CharacterSocialActivityJobService,
    CharacterPostViewRepository,
    CharacterPostViewService,
    CharacterFollowRepository,
    CharacterFollowService,
    {
      provide: CHARACTER_SOCIAL_WORKER_OPTIONS,
      useFactory: () => characterSocialWorkerOptions(),
    },
  ],
  exports: [
    CharacterSocialActivityApplicationService,
    CharacterSocialActivityJobService,
    CharacterSocialActivityPolicyService,
    CharacterPostViewService,
    CharacterFollowService,
    CharacterSocialWorker,
    CHARACTER_SOCIAL_WORKER_OPTIONS,
  ],
})
export class CharacterSocialModule {}
