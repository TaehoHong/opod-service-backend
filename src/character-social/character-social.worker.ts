import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  CHARACTER_SOCIAL_WORKER_OPTIONS,
  CharacterSocialWorkerOptions,
} from "./character-social.options";
import { CharacterSocialActivityApplicationService } from "./character-social-activity-application.service";

export {
  CHARACTER_SOCIAL_WORKER_OPTIONS,
  CharacterSocialWorkerOptions,
  characterSocialWorkerOptions,
} from "./character-social.options";

@Injectable()
export class CharacterSocialWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CharacterSocialWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly application: CharacterSocialActivityApplicationService,
    @Inject(CHARACTER_SOCIAL_WORKER_OPTIONS)
    private readonly options: CharacterSocialWorkerOptions,
  ) {}

  onModuleInit(): void {
    if (this.options.enabled) this.scheduleTick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async runOnce(now?: Date): Promise<number> {
    await this.application.scheduleDueActivities(now);
    let processed = 0;
    while (processed < this.options.batchSize) {
      try {
        if (!(await this.application.processNextActivity(now))) break;
      } catch (error) {
        this.logger.error(
          "Character social activity failed",
          error instanceof Error ? error.stack : undefined,
        );
      }
      processed += 1;
    }
    return processed;
  }

  private scheduleTick(): void {
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error(
          "Character social worker tick failed",
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        if (!this.stopped) this.scheduleTick();
      }
    }, this.options.pollIntervalMs);
    this.timer.unref();
  }
}
