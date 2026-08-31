import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { CharactersService } from "../characters/characters.service";
import { DatabaseService } from "../database/database.service";
import {
  agentRelationshipState,
  characters,
  userCharacterFollows,
} from "../database/schema";
import { EventsService } from "../events/events.service";
import { UsersService } from "../users/users.service";

export type CharacterFollow = {
  userId: string;
  characterId: string;
  createdAt: string;
};

type CharacterUnfollow = {
  userId: string;
  characterId: string;
  deleted: boolean;
};

type CharacterRelationship = {
  characterId: string;
  isFollowing: boolean;
  followedAt?: string;
  /**
   * How far the DM relationship with this character has come. 1 for anyone who
   * has never talked to them. Derived from lifetime bond XP by opod-agent and
   * stored, so nothing here knows the curve.
   *
   * Only this axis is exposed. The row also carries `warmth`, which decays with
   * time — that one stays server-side on purpose. DM replies cost credits, so
   * showing a gauge that visibly cools would turn the relationship into a
   * reason to spend rather than a result of talking.
   */
  bondLevel: number;
};

type CharacterFollowRow = typeof userCharacterFollows.$inferSelect;

@Injectable()
export class FollowsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly charactersService: CharactersService,
    private readonly database: DatabaseService,
    @Optional()
    @Inject(EventsService)
    private readonly eventsService?: EventsService,
  ) {}

  async followCharacter(input: {
    userId: string;
    characterId: string;
  }): Promise<CharacterFollow> {
    await this.assertUserAndCharacter(input);

    const [follow] = await this.database.client
      .insert(userCharacterFollows)
      .values(input)
      .onConflictDoUpdate({
        target: [userCharacterFollows.userId, userCharacterFollows.characterId],
        set: { characterId: input.characterId },
      })
      .returning();
    await this.recordFollowEvent(input).catch(() => undefined);
    return this.toCharacterFollow(follow);
  }

  async unfollowCharacter(input: {
    userId: string;
    characterId: string;
  }): Promise<CharacterUnfollow> {
    await this.assertUserAndCharacter(input);

    const deleted = await this.database.client
      .delete(userCharacterFollows)
      .where(
        and(
          eq(userCharacterFollows.userId, input.userId),
          eq(userCharacterFollows.characterId, input.characterId),
        ),
      )
      .returning({ characterId: userCharacterFollows.characterId });
    return { ...input, deleted: deleted.length > 0 };
  }

  async listFollowedCharacters(userId: string): Promise<CharacterFollow[]> {
    const follows = await this.database.client
      .select({
        userId: userCharacterFollows.userId,
        characterId: userCharacterFollows.characterId,
        createdAt: userCharacterFollows.createdAt,
        notifiedUpToAt: userCharacterFollows.notifiedUpToAt,
      })
      .from(userCharacterFollows)
      .innerJoin(
        characters,
        eq(userCharacterFollows.characterId, characters.id),
      )
      .where(
        and(
          eq(userCharacterFollows.userId, userId),
          eq(characters.status, "active"),
        ),
      )
      .orderBy(asc(userCharacterFollows.createdAt));
    return follows.map((follow) => this.toCharacterFollow(follow));
  }

  async followedCharacterIdsFor(userId: string): Promise<Set<string>> {
    const follows = await this.database.client
      .select({ characterId: userCharacterFollows.characterId })
      .from(userCharacterFollows)
      .innerJoin(
        characters,
        eq(userCharacterFollows.characterId, characters.id),
      )
      .where(
        and(
          eq(userCharacterFollows.userId, userId),
          eq(characters.status, "active"),
        ),
      );
    return new Set(follows.map((follow) => follow.characterId));
  }

  async getCharacterRelationship(input: {
    userId: string;
    characterId: string;
  }): Promise<CharacterRelationship> {
    await this.assertUserAndCharacter(input);

    // agent_relationship_state is opod-agent's table (the canonical schema keeps the
    // ownership note); this service only ever reads bond_level from it, and
    // never writes. It has no FK to users/characters — identity reaches the
    // Agent through X-Opod-* headers — so an absent row simply means "they have
    // never talked", which is level 1.
    const [follow, bond] = await Promise.all([
      this.database.client
        .select({
          userId: userCharacterFollows.userId,
          characterId: userCharacterFollows.characterId,
          createdAt: userCharacterFollows.createdAt,
          notifiedUpToAt: userCharacterFollows.notifiedUpToAt,
        })
        .from(userCharacterFollows)
        .where(
          and(
            eq(userCharacterFollows.userId, input.userId),
            eq(userCharacterFollows.characterId, input.characterId),
          ),
        )
        .limit(1)
        .then(([row]) => row),
      this.database.client
        .select({ bondLevel: agentRelationshipState.bondLevel })
        .from(agentRelationshipState)
        .where(
          and(
            eq(agentRelationshipState.userId, input.userId),
            eq(agentRelationshipState.characterId, input.characterId),
          ),
        )
        .limit(1)
        .then(([row]) => row),
    ]);

    return {
      characterId: input.characterId,
      isFollowing: follow !== undefined,
      ...(follow ? { followedAt: follow.createdAt.toISOString() } : {}),
      bondLevel: bond?.bondLevel ?? 1,
    };
  }

  private async assertUserAndCharacter(input: {
    userId: string;
    characterId: string;
  }) {
    if (!(await this.usersService.hasUser(input.userId))) {
      throw new BadRequestException("User not found");
    }
    if (!(await this.charactersService.hasCharacter(input.characterId))) {
      throw new BadRequestException("Character not found");
    }
  }

  private toCharacterFollow(follow: CharacterFollowRow): CharacterFollow {
    return {
      userId: follow.userId,
      characterId: follow.characterId,
      createdAt: follow.createdAt.toISOString(),
    };
  }

  private async recordFollowEvent(input: {
    userId: string;
    characterId: string;
  }) {
    await this.eventsService?.recordEvent({
      userId: input.userId,
      eventType: "follow_character",
      targetType: "character",
      targetId: input.characterId,
    });
  }
}
