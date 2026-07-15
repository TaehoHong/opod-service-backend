import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { publicMediaUrl } from "../media/media-url";
import { PrismaService } from "../database/prisma.service";

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

type PrismaStory = Prisma.StoryGetPayload<{ include: { media: true } }>;

type StoryWhere = {
  characterId?: string;
  character: { status: "active" };
  expiresAt: { gt: Date };
};

@Injectable()
export class StoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listStoriesPage(input: PageInput): Promise<Page<Story>> {
    return this.listActiveStoriesPage(
      {
        character: { status: "active" },
        expiresAt: { gt: new Date() },
      },
      input,
    );
  }

  async listCharacterStoriesPage(
    characterId: string,
    input: PageInput,
  ): Promise<Page<Story>> {
    return this.listActiveStoriesPage(
      {
        characterId,
        character: { status: "active" },
        expiresAt: { gt: new Date() },
      },
      input,
    );
  }

  private async listActiveStoriesPage(
    where: StoryWhere,
    input: PageInput,
  ): Promise<Page<Story>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.story.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const stories = await this.prisma.story.findMany({
      where,
      include: { media: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      stories.map((story) => this.toStory(story as PrismaStory)),
      input.limit,
    );
  }

  private toStory(story: PrismaStory): Story {
    return {
      id: story.id,
      characterId: story.characterId,
      caption: story.caption,
      media: {
        mediaType: story.media.mediaType,
        url: publicMediaUrl(story.media),
        ...(story.media.width ? { width: story.media.width } : {}),
        ...(story.media.height ? { height: story.media.height } : {}),
        ...(story.media.durationSeconds
          ? { durationSeconds: story.media.durationSeconds }
          : {}),
      },
      createdAt: story.createdAt.toISOString(),
      expiresAt: story.expiresAt.toISOString(),
    };
  }
}
