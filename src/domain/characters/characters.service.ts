import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { isUuid } from "../database/uuid";
import { publicMediaUrl } from "../media/media-url";

export type Character = {
  id: string;
  publicId: string;
  displayName: string;
  bio: string;
  interests: string[];
  profileImage?: {
    url: string;
    width?: number;
    height?: number;
    crop: {
      x: number;
      y: number;
      zoom: number;
    };
  };
};

type CharacterRow = Omit<Character, "profileImage"> & {
  profileImageCropX: number;
  profileImageCropY: number;
  profileImageCropZoom: number;
  profileImage: {
    url: string;
    storageKey: string | null;
    width: number | null;
    height: number | null;
  } | null;
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
    const characters = await this.prisma.character.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "desc" },
      select: this.characterFields,
    });
    return characters.map((character) => this.toCharacter(character));
  }

  async searchCharacters(query: string, limit: number): Promise<Character[]> {
    const term = query.trim();
    const characters = await this.prisma.character.findMany({
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
    return characters.map((character) => this.toCharacter(character));
  }

  async findCharacter(characterId: string): Promise<Character | null> {
    if (!isUuid(characterId)) {
      return null;
    }
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, status: "active" },
      select: this.characterFields,
    });
    return character ? this.toCharacter(character) : null;
  }

  private readonly characterFields = {
    id: true,
    publicId: true,
    displayName: true,
    bio: true,
    interests: true,
    profileImageCropX: true,
    profileImageCropY: true,
    profileImageCropZoom: true,
    profileImage: {
      select: {
        url: true,
        storageKey: true,
        width: true,
        height: true,
      },
    },
  } as const;

  private toCharacter(character: CharacterRow): Character {
    return {
      id: character.id,
      publicId: character.publicId,
      displayName: character.displayName,
      bio: character.bio,
      interests: character.interests,
      ...(character.profileImage
        ? {
            profileImage: {
              url: publicMediaUrl(character.profileImage),
              ...(character.profileImage.width !== null
                ? { width: character.profileImage.width }
                : {}),
              ...(character.profileImage.height !== null
                ? { height: character.profileImage.height }
                : {}),
              crop: {
                x: character.profileImageCropX,
                y: character.profileImageCropY,
                zoom: character.profileImageCropZoom,
              },
            },
          }
        : {}),
    };
  }
}
