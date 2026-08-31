import { BadRequestException, Injectable } from "@nestjs/common";
import { and, desc, eq, gt, lt, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { characters, media, stories } from "../database/schema";
import { publicMediaUrl } from "../media/media-url";

type MediaType = "image" | "video";

type StoryMedia = {
  mediaType: MediaType;
  url: string;
  storageKey?: string | null;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type Story = {
  id: string;
  characterId: string;
  caption: string;
  media: StoryMedia;
  createdAt: string;
  expiresAt: string;
};

type StoryRow = {
  id: string;
  characterId: string;
  caption: string;
  mediaType: MediaType;
  url: string;
  storageKey: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  createdAt: Date;
  expiresAt: Date;
};

@Injectable()
export class StoriesService {
  constructor(private readonly database: DatabaseService) {}

  async listStoriesPage(input: PageInput): Promise<Page<Story>> {
    return this.listActiveStoriesPage(undefined, input);
  }

  async listCharacterStoriesPage(
    characterId: string,
    input: PageInput,
  ): Promise<Page<Story>> {
    return this.listActiveStoriesPage(characterId, input);
  }

  private async listActiveStoriesPage(
    characterId: string | undefined,
    input: PageInput,
  ): Promise<Page<Story>> {
    const cursorId = decodeCursor(input.cursor);
    const now = new Date();
    const activeWhere = and(
      eq(characters.status, "active"),
      gt(stories.expiresAt, now),
      characterId ? eq(stories.characterId, characterId) : undefined,
    );
    const [cursor] = cursorId
      ? await this.database.client
          .select({ createdAt: stories.createdAt })
          .from(stories)
          .innerJoin(characters, eq(stories.characterId, characters.id))
          .where(and(eq(stories.id, cursorId), activeWhere))
          .limit(1)
      : [];
    if (cursorId && !cursor) {
      throw new BadRequestException("Invalid cursor");
    }

    const rows = await this.database.client
      .select({
        id: stories.id,
        characterId: stories.characterId,
        caption: stories.caption,
        mediaType: media.mediaType,
        url: media.url,
        storageKey: media.storageKey,
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
        createdAt: stories.createdAt,
        expiresAt: stories.expiresAt,
      })
      .from(stories)
      .innerJoin(characters, eq(stories.characterId, characters.id))
      .innerJoin(media, eq(stories.mediaId, media.id))
      .where(
        and(
          activeWhere,
          cursor && cursorId
            ? or(
                lt(stories.createdAt, cursor.createdAt),
                and(
                  eq(stories.createdAt, cursor.createdAt),
                  lt(stories.id, cursorId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(stories.createdAt), desc(stories.id))
      .limit(input.limit + 1);
    return pageFromRows(
      rows.map((story) => this.toStory(story)),
      input.limit,
    );
  }

  private toStory(story: StoryRow): Story {
    return {
      id: story.id,
      characterId: story.characterId,
      caption: story.caption,
      media: {
        mediaType: story.mediaType,
        url: publicMediaUrl(story),
        ...(story.width ? { width: story.width } : {}),
        ...(story.height ? { height: story.height } : {}),
        ...(story.durationSeconds
          ? { durationSeconds: story.durationSeconds }
          : {}),
      },
      createdAt: story.createdAt.toISOString(),
      expiresAt: story.expiresAt.toISOString(),
    };
  }
}
