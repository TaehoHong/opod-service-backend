import { BadRequestException, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { CharactersService } from "../characters/characters.service";
import { DatabaseService } from "../database/database.service";
import {
  hashtags as hashtagTable,
  userEvents,
  userHashtagPreferences,
} from "../database/schema";
import { PostsService } from "../posts/posts.service";

export type UserEventInput = {
  userId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
};

export type ClientEventInput = Omit<UserEventInput, "userId">;

const EVENT_WEIGHTS: Record<string, number> = {
  feed_view: 0.2,
  post_open: 1,
  follow_character: 3,
  message_character: 4,
};

@Injectable()
export class EventsService {
  constructor(
    private readonly postsService: PostsService,
    private readonly charactersService: CharactersService,
    private readonly database: DatabaseService,
  ) {}

  async recordEvent(input: UserEventInput): Promise<{ accepted: true }> {
    const event = this.normalizeEvent(input);
    await this.storeEventAndSchedulePreferenceUpdate(event);

    return { accepted: true };
  }

  async recordClientEvent(
    userId: string,
    input: ClientEventInput,
  ): Promise<{ accepted: true }> {
    const event = this.normalizeEvent({ ...input, userId });
    if (
      !["feed_view", "post_open"].includes(event.eventType) ||
      event.targetType !== "post"
    ) {
      throw new BadRequestException("Unsupported client event");
    }
    if (!(await this.postsService.hasPost(event.targetId))) {
      throw new BadRequestException("Event target not found");
    }
    await this.storeEventAndSchedulePreferenceUpdate(event);

    return { accepted: true };
  }

  async hashtagPreferencesFor(userId: string): Promise<Map<string, number>> {
    const preferences = await this.database.client
      .select({ name: hashtagTable.name, score: userHashtagPreferences.score })
      .from(userHashtagPreferences)
      .innerJoin(
        hashtagTable,
        eq(userHashtagPreferences.hashtagId, hashtagTable.id),
      )
      .where(eq(userHashtagPreferences.userId, userId));
    return new Map(
      preferences.map((preference) => [preference.name, preference.score]),
    );
  }

  private normalizeEvent(input: UserEventInput): UserEventInput {
    const userId = this.requiredString(input.userId, "userId");
    const eventType = this.requiredString(input.eventType, "eventType");
    const targetType = this.requiredString(input.targetType, "targetType");
    const targetId = this.requiredString(input.targetId, "targetId");

    if (
      input.metadata !== undefined &&
      (input.metadata === null ||
        typeof input.metadata !== "object" ||
        Array.isArray(input.metadata))
    ) {
      throw new BadRequestException("metadata must be an object");
    }

    return {
      userId,
      eventType,
      targetType,
      targetId,
      metadata: input.metadata,
    };
  }

  private requiredString(value: string, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }

  private async storeEventAndSchedulePreferenceUpdate(input: UserEventInput) {
    await this.storeEvent(input);

    void this.updatePreferences(input).catch(() => undefined);
  }

  private async updatePreferences(input: UserEventInput) {
    const weight = EVENT_WEIGHTS[input.eventType];
    if (!weight) {
      return;
    }

    const hashtags = await this.hashtagsFor(input);
    if (hashtags.length === 0) {
      return;
    }

    await this.increaseHashtagPreferences(input.userId, hashtags, weight);
  }

  private async storeEvent(input: UserEventInput) {
    await this.database.client.insert(userEvents).values({
      userId: input.userId,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    });
  }

  private async hashtagsFor(input: UserEventInput): Promise<string[]> {
    if (
      input.targetType === "post" &&
      ["feed_view", "post_open"].includes(input.eventType)
    ) {
      return this.cleanHashtags(
        (await this.postsService.findPost(input.targetId))?.hashtags,
      );
    }

    if (
      input.targetType === "character" &&
      ["follow_character", "message_character"].includes(input.eventType)
    ) {
      return this.cleanHashtags(
        (await this.charactersService.findCharacter(input.targetId))?.interests,
      );
    }

    return [];
  }

  private cleanHashtags(hashtags: string[] | undefined): string[] {
    return [
      ...new Set(
        (hashtags ?? []).map((hashtag) => hashtag.trim()).filter(Boolean),
      ),
    ];
  }

  private async increaseHashtagPreferences(
    userId: string,
    hashtags: string[],
    weight: number,
  ) {
    const rows = await Promise.all(
      hashtags.map((name) =>
        this.database.client
          .insert(hashtagTable)
          .values({ name })
          .onConflictDoUpdate({
            target: hashtagTable.name,
            set: { name },
          })
          .returning({ id: hashtagTable.id }),
      ),
    );
    await Promise.all(
      rows.map(([hashtag]) =>
        this.database.client
          .insert(userHashtagPreferences)
          .values({
            userId,
            hashtagId: hashtag.id,
            score: weight,
          })
          .onConflictDoUpdate({
            target: [
              userHashtagPreferences.userId,
              userHashtagPreferences.hashtagId,
            ],
            set: {
              score: sql`${userHashtagPreferences.score} + ${weight}`,
              updatedAt: new Date(),
            },
          }),
      ),
    );
  }
}
