import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { isUuid } from "../database/uuid";

export type Character = {
  id: string;
  publicId: string;
  displayName: string;
  bio: string;
  interests: string[];
};

@Injectable()
export class CharactersService {
  constructor(private readonly prisma: PrismaService) {}

  async hasCharacter(characterId: string): Promise<boolean> {
    if (!isUuid(characterId)) {
      return false;
    }
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, status: "active" },
      select: { id: true },
    });
    return character !== null;
  }

  async listCharacters(): Promise<Character[]> {
    return this.prisma.character.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "desc" },
      select: this.characterFields,
    });
  }

  async searchCharacters(query: string, limit: number): Promise<Character[]> {
    const term = query.trim();
    return this.prisma.character.findMany({
      where: {
        status: "active",
        OR: [
          { publicId: { contains: term, mode: "insensitive" } },
          { displayName: { contains: term, mode: "insensitive" } },
          { bio: { contains: term, mode: "insensitive" } },
          { interests: { has: term } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: this.characterFields,
    });
  }

  async findCharacter(characterId: string): Promise<Character | null> {
    if (!isUuid(characterId)) {
      return null;
    }
    return this.prisma.character.findFirst({
      where: { id: characterId, status: "active" },
      select: this.characterFields,
    });
  }

  private readonly characterFields = {
    id: true,
    publicId: true,
    displayName: true,
    bio: true,
    interests: true,
  } as const;
}
