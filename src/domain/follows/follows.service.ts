import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CharactersService } from "../characters/characters.service";
import { PrismaService } from "../database/prisma.service";
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

type PrismaCharacterFollow =
  Prisma.UserCharacterFollowGetPayload<Prisma.UserCharacterFollowDefaultArgs>;

@Injectable()
export class FollowsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly charactersService: CharactersService,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(EventsService)
    private readonly eventsService?: EventsService,
  ) {}

  async followCharacter(input: {
    userId: string;
    characterId: string;
  }): Promise<CharacterFollow> {
    await this.assertUserAndCharacter(input);

    const follow = await this.prisma.userCharacterFollow.upsert({
      where: {
        userId_characterId: {
          userId: input.userId,
          characterId: input.characterId,
        },
      },
      update: {},
      create: input,
    });
    await this.recordFollowEvent(input).catch(() => undefined);
    return this.toCharacterFollow(follow);
  }

  async unfollowCharacter(input: {
    userId: string;
    characterId: string;
  }): Promise<CharacterUnfollow> {
    await this.assertUserAndCharacter(input);

    const result = await this.prisma.userCharacterFollow.deleteMany({
      where: input,
    });
    return { ...input, deleted: result.count > 0 };
  }

  async listFollowedCharacters(userId: string): Promise<CharacterFollow[]> {
    const follows = await this.prisma.userCharacterFollow.findMany({
      where: { userId, character: { status: "active" } },
      orderBy: { createdAt: "asc" },
    });
    return follows.map((follow) => this.toCharacterFollow(follow));
  }

  async followedCharacterIdsFor(userId: string): Promise<Set<string>> {
    const follows = await this.prisma.userCharacterFollow.findMany({
      where: { userId, character: { status: "active" } },
      select: { characterId: true },
    });
    return new Set(follows.map((follow) => follow.characterId));
  }

  async getCharacterRelationship(input: {
    userId: string;
    characterId: string;
  }): Promise<CharacterRelationship> {
    await this.assertUserAndCharacter(input);

    // agent_relationship_state is opod-agent's table (schema.prisma keeps the
    // ownership note); this service only ever reads bond_level from it, and
    // never writes. It has no FK to users/characters — identity reaches the
    // Agent through X-Opod-* headers — so an absent row simply means "they have
    // never talked", which is level 1.
    const [follow, bond] = await Promise.all([
      this.prisma.userCharacterFollow.findUnique({
        where: {
          userId_characterId: {
            userId: input.userId,
            characterId: input.characterId,
          },
        },
      }),
      this.prisma.agentRelationshipState.findUnique({
        where: {
          userId_characterId: {
            userId: input.userId,
            characterId: input.characterId,
          },
        },
        select: { bondLevel: true },
      }),
    ]);

    return {
      characterId: input.characterId,
      isFollowing: follow !== null,
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

  private toCharacterFollow(follow: PrismaCharacterFollow): CharacterFollow {
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
