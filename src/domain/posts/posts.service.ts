import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";

type MediaType = "image" | "video";
export type PostContentType = "feed" | "reel";

type DirectMediaInput = {
  mediaType: MediaType;
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type Post = {
  id: string;
  characterId: string;
  contentType: PostContentType;
  content: string;
  media: DirectMediaInput[];
  hashtags: string[];
  createdAt: string;
};

export type PostComment = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  body: string;
  createdAt: string;
};

export type PostReaction = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  reactionType: string;
  createdAt: string;
};

type PrismaPost = {
  id: string;
  characterId: string;
  contentType: PostContentType;
  content: string;
  createdAt: Date;
  hashtags: Array<{
    hashtag: {
      name: string;
    };
  }>;
  postMedia: Array<{
    media: DirectMediaInput;
  }>;
};

type PrismaPostComment = Omit<
  PostComment,
  "createdAt" | "characterId" | "userId"
> & {
  characterId: string | null;
  userId: string | null;
  createdAt: Date;
};

type PrismaPostReaction = Omit<
  PostReaction,
  "createdAt" | "characterId" | "userId"
> & {
  characterId: string | null;
  userId: string | null;
  createdAt: Date;
};

type PostFilters = {
  characterId?: string;
  contentType?: PostContentType;
  hashtag?: string;
  mediaType?: MediaType;
};

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async hasPost(postId: string): Promise<boolean> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    return post !== null;
  }

  async listPosts(): Promise<Post[]> {
    const posts = await this.prisma.post.findMany({
      include: this.postWithMedia,
      orderBy: { createdAt: "desc" },
    });
    return posts.map((post) => this.toPost(post as PrismaPost));
  }

  async listPostsPage(input: PageInput & PostFilters): Promise<Page<Post>> {
    const cursorId = decodeCursor(input.cursor);
    const where = this.postWhere(input);
    if (
      cursorId &&
      !(await this.prisma.post.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const posts = await this.prisma.post.findMany({
      ...(Object.keys(where).length ? { where } : {}),
      include: this.postWithMedia,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      posts.map((post) => this.toPost(post as PrismaPost)),
      input.limit,
    );
  }

  async listCharacterPostsPage(
    characterId: string,
    input: PageInput,
  ): Promise<Page<Post>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.post.findFirst({
        where: { id: cursorId, characterId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const posts = await this.prisma.post.findMany({
      where: { characterId },
      include: this.postWithMedia,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      posts.map((post) => this.toPost(post as PrismaPost)),
      input.limit,
    );
  }

  async searchPosts(query: string, limit: number): Promise<Post[]> {
    const term = query.trim();
    const posts = await this.prisma.post.findMany({
      where: {
        OR: [
          { content: { contains: term, mode: "insensitive" } },
          {
            hashtags: {
              some: {
                hashtag: { name: { contains: term, mode: "insensitive" } },
              },
            },
          },
        ],
      },
      include: this.postWithMedia,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return posts.map((post) => this.toPost(post as PrismaPost));
  }

  async searchHashtags(query: string, limit: number): Promise<string[]> {
    const term = query.trim();
    const hashtags = await this.prisma.hashtag.findMany({
      where: { name: { contains: term, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: limit,
      select: { name: true },
    });
    return hashtags.map((hashtag) => hashtag.name);
  }

  async findPost(postId: string): Promise<Post | null> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: this.postWithMedia,
    });
    return post ? this.toPost(post as PrismaPost) : null;
  }

  async listPostCommentsPage(
    postId: string,
    input: PageInput,
  ): Promise<Page<PostComment>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.postComment.findFirst({
        where: { id: cursorId, postId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const comments = await this.prisma.postComment.findMany({
      where: { postId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      comments.map((comment) =>
        this.toPostComment(comment as PrismaPostComment),
      ),
      input.limit,
    );
  }

  async createUserComment(input: {
    postId: string;
    userId: string;
    body: string;
  }): Promise<PostComment> {
    const body = input.body.trim();
    if (!body) {
      throw new BadRequestException("Comment body is required");
    }

    const comment = await this.prisma.postComment.create({
      data: {
        postId: input.postId,
        userId: input.userId,
        body,
      },
    });
    return this.toPostComment(comment as PrismaPostComment);
  }

  async listPostReactions(
    postId: string,
  ): Promise<{ items: PostReaction[]; counts: Record<string, number> }> {
    const reactions = await this.prisma.postReaction.findMany({
      where: { postId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const items = reactions.map((reaction) =>
      this.toPostReaction(reaction as PrismaPostReaction),
    );
    return {
      items,
      counts: items.reduce<Record<string, number>>((counts, reaction) => {
        counts[reaction.reactionType] =
          (counts[reaction.reactionType] ?? 0) + 1;
        return counts;
      }, {}),
    };
  }

  async createUserReaction(input: {
    postId: string;
    userId: string;
    reactionType: string;
  }): Promise<PostReaction> {
    const reactionType = this.requiredReactionType(input.reactionType);
    const reaction = await this.prisma.postReaction.upsert({
      where: {
        postId_userId_reactionType: {
          postId: input.postId,
          userId: input.userId,
          reactionType,
        },
      },
      update: {},
      create: {
        postId: input.postId,
        userId: input.userId,
        reactionType,
      },
    });
    return this.toPostReaction(reaction as PrismaPostReaction);
  }

  async deleteUserReaction(input: {
    postId: string;
    userId: string;
    reactionType: string;
  }): Promise<{
    postId: string;
    userId: string;
    reactionType: string;
    deleted: boolean;
  }> {
    const reactionType = this.requiredReactionType(input.reactionType);
    const result = await this.prisma.postReaction.deleteMany({
      where: {
        postId: input.postId,
        userId: input.userId,
        reactionType,
      },
    });
    return {
      postId: input.postId,
      userId: input.userId,
      reactionType,
      deleted: result.count > 0,
    };
  }

  private readonly postWithMedia = {
    postMedia: {
      include: { media: true },
      orderBy: { sortOrder: "asc" },
    },
    hashtags: {
      include: { hashtag: true },
      orderBy: { hashtag: { name: "asc" } },
    },
  } as const;

  private postWhere(input: PostFilters) {
    const where: {
      characterId?: string;
      contentType?: PostContentType;
      hashtags?: { some: { hashtag: { name: string } } };
      postMedia?: { some: { media: { mediaType: MediaType } } };
    } = {};
    if (input.characterId?.trim()) {
      where.characterId = input.characterId.trim();
    }
    if (input.contentType) {
      if (input.contentType !== "feed" && input.contentType !== "reel") {
        throw new BadRequestException("Invalid content type");
      }
      where.contentType = input.contentType;
    }
    if (input.hashtag?.trim()) {
      where.hashtags = {
        some: { hashtag: { name: input.hashtag.trim() } },
      };
    }
    if (input.mediaType) {
      if (input.mediaType !== "image" && input.mediaType !== "video") {
        throw new BadRequestException("Invalid media type");
      }
      where.postMedia = {
        some: {
          media: {
            mediaType: input.mediaType,
          },
        },
      };
    }
    return where;
  }

  private toPost(post: PrismaPost): Post {
    return {
      id: post.id,
      characterId: post.characterId,
      contentType: post.contentType,
      content: post.content,
      media: post.postMedia.map((item) => ({
        mediaType: item.media.mediaType,
        url: item.media.url,
        ...(item.media.width ? { width: item.media.width } : {}),
        ...(item.media.height ? { height: item.media.height } : {}),
        ...(item.media.durationSeconds
          ? { durationSeconds: item.media.durationSeconds }
          : {}),
      })),
      hashtags: post.hashtags.map((item) => item.hashtag.name),
      createdAt: post.createdAt.toISOString(),
    };
  }

  private toPostComment(comment: PrismaPostComment): PostComment {
    return {
      id: comment.id,
      postId: comment.postId,
      ...(comment.characterId ? { characterId: comment.characterId } : {}),
      ...(comment.userId ? { userId: comment.userId } : {}),
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  private toPostReaction(reaction: PrismaPostReaction): PostReaction {
    return {
      id: reaction.id,
      postId: reaction.postId,
      ...(reaction.characterId ? { characterId: reaction.characterId } : {}),
      ...(reaction.userId ? { userId: reaction.userId } : {}),
      reactionType: reaction.reactionType,
      createdAt: reaction.createdAt.toISOString(),
    };
  }

  private requiredReactionType(reactionType: string): string {
    const trimmed = reactionType.trim();
    if (!trimmed) {
      throw new BadRequestException("Reaction type is required");
    }
    return trimmed;
  }
}
