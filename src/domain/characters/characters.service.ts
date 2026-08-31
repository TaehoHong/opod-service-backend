import { Injectable } from "@nestjs/common";
import { and, arrayContains, desc, eq, ilike, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { characters, media } from "../database/schema";
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

type CharacterRow = Omit<Character, "profileImage" | "interests"> & {
  interests: string[] | null;
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
  constructor(private readonly database: DatabaseService) {}

  async hasCharacter(characterId: string): Promise<boolean> {
    if (!isUuid(characterId)) {
      return false;
    }
    const [character] = await this.database.client
      .select({ id: characters.id })
      .from(characters)
      .where(
        and(eq(characters.id, characterId), eq(characters.status, "active")),
      )
      .limit(1);
    return character !== undefined;
  }

  async listCharacters(): Promise<Character[]> {
    const rows = await this.database.client
      .select(this.characterFields)
      .from(characters)
      .leftJoin(media, eq(characters.profileImageId, media.id))
      .where(eq(characters.status, "active"))
      .orderBy(desc(characters.createdAt));
    return rows.map((character) => this.toCharacter(character));
  }

  async searchCharacters(query: string, limit: number): Promise<Character[]> {
    const term = query.trim();
    const rows = await this.database.client
      .select(this.characterFields)
      .from(characters)
      .leftJoin(media, eq(characters.profileImageId, media.id))
      .where(
        and(
          eq(characters.status, "active"),
          or(
            ilike(characters.publicId, `%${term}%`),
            ilike(characters.displayName, `%${term}%`),
            ilike(characters.bio, `%${term}%`),
            arrayContains(characters.interests, [term]),
          ),
        ),
      )
      .orderBy(desc(characters.createdAt))
      .limit(limit);
    return rows.map((character) => this.toCharacter(character));
  }

  async findCharacter(characterId: string): Promise<Character | null> {
    if (!isUuid(characterId)) {
      return null;
    }
    const [character] = await this.database.client
      .select(this.characterFields)
      .from(characters)
      .leftJoin(media, eq(characters.profileImageId, media.id))
      .where(
        and(eq(characters.id, characterId), eq(characters.status, "active")),
      )
      .limit(1);
    return character ? this.toCharacter(character) : null;
  }

  private readonly characterFields = {
    id: characters.id,
    publicId: characters.publicId,
    displayName: characters.displayName,
    bio: characters.bio,
    interests: characters.interests,
    profileImageCropX: characters.profileImageCropX,
    profileImageCropY: characters.profileImageCropY,
    profileImageCropZoom: characters.profileImageCropZoom,
    profileImage: {
      url: media.url,
      storageKey: media.storageKey,
      width: media.width,
      height: media.height,
    },
  };

  private toCharacter(character: CharacterRow): Character {
    return {
      id: character.id,
      publicId: character.publicId,
      displayName: character.displayName,
      bio: character.bio,
      interests: character.interests ?? [],
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
