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

    const follow = await this.prisma.userCharacterFollow.findUnique({
      where: {
        userId_characterId: {
          userId: input.userId,
          characterId: input.characterId,
        },
      },
    });

    return {
      characterId: input.characterId,
      isFollowing: follow !== null,
      ...(follow ? { followedAt: follow.createdAt.toISOString() } : {}),
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
