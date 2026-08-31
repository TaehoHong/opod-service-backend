import { BadRequestException, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import {
  characters as characterTable,
  hashtags as hashtagTable,
  media as mediaTable,
  postComments,
  postHashtags,
  postMedia,
  postReactions,
  posts as postTable,
} from "../database/schema";
import { isUuid } from "../database/uuid";
import { publicMediaUrl } from "../media/media-url";

type MediaType = "image" | "video";
export type PostContentType = "feed" | "reel";

type DirectMediaInput = {
  mediaType: MediaType;
  url: string;
  storageKey?: string | null;
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

type PostRow = Pick<
  typeof postTable.$inferSelect,
  "id" | "characterId" | "contentType" | "content" | "createdAt"
>;

type PostCommentRow = typeof postComments.$inferSelect;
type PostReactionRow = typeof postReactions.$inferSelect;

type PostFilters = {
  characterId?: string;
  contentType?: PostContentType;
  hashtag?: string;
  mediaType?: MediaType;
};

const postFields = {
  id: postTable.id,
  characterId: postTable.characterId,
  contentType: postTable.contentType,
  content: postTable.content,
  createdAt: postTable.createdAt,
};

@Injectable()
export class PostsService {
  constructor(private readonly database: DatabaseService) {}

  async hasPost(postId: string): Promise<boolean> {
    if (!isUuid(postId)) {
      return false;
    }
    const [post] = await this.database.client
      .select({ id: postTable.id })
      .from(postTable)
      .innerJoin(characterTable, eq(postTable.characterId, characterTable.id))
      .where(and(eq(postTable.id, postId), eq(characterTable.status, "active")))
      .limit(1);
    return post !== undefined;
  }

  async listPosts(): Promise<Post[]> {
    const rows = await this.database.client
      .select(postFields)
      .from(postTable)
      .innerJoin(characterTable, eq(postTable.characterId, characterTable.id))
      .where(eq(characterTable.status, "active"))
      .orderBy(desc(postTable.createdAt));
    return this.hydratePosts(rows);
  }

  async listPostsPage(input: PageInput & PostFilters): Promise<Page<Post>> {
    return this.listPostsWithConditionsPage(this.postConditions(input), input);
  }

  async listCharacterPostsPage(
    characterId: string,
    input: PageInput,
  ): Promise<Page<Post>> {
    return this.listPostsWithConditionsPage(
      [
        eq(characterTable.status, "active"),
        eq(postTable.characterId, characterId),
      ],
      input,
    );
  }

  async searchPosts(query: string, limit: number): Promise<Post[]> {
    const term = query.trim();
    const hashtagMatch = this.database.client
      .select({ value: sql`1` })
      .from(postHashtags)
      .innerJoin(hashtagTable, eq(postHashtags.hashtagId, hashtagTable.id))
      .where(
        and(
          eq(postHashtags.postId, postTable.id),
          ilike(hashtagTable.name, `%${term}%`),
        ),
      );
    const rows = await this.database.client
      .select(postFields)
      .from(postTable)
      .innerJoin(characterTable, eq(postTable.characterId, characterTable.id))
      .where(
        and(
          eq(characterTable.status, "active"),
          or(ilike(postTable.content, `%${term}%`), exists(hashtagMatch)),
        ),
      )
      .orderBy(desc(postTable.createdAt))
      .limit(limit);
    return this.hydratePosts(rows);
  }

  async searchHashtags(query: string, limit: number): Promise<string[]> {
    const term = query.trim();
    const rows = await this.database.client
      .select({ name: hashtagTable.name })
      .from(hashtagTable)
      .innerJoin(postHashtags, eq(hashtagTable.id, postHashtags.hashtagId))
      .innerJoin(postTable, eq(postHashtags.postId, postTable.id))
      .innerJoin(characterTable, eq(postTable.characterId, characterTable.id))
      .where(
        and(
          ilike(hashtagTable.name, `%${term}%`),
          eq(characterTable.status, "active"),
        ),
      )
      .groupBy(hashtagTable.name)
      .orderBy(asc(hashtagTable.name))
      .limit(limit);
    return rows.map((row) => row.name);
  }

  async findPost(postId: string): Promise<Post | null> {
    if (!isUuid(postId)) {
      return null;
    }
    const [row] = await this.database.client
      .select(postFields)
      .from(postTable)
      .innerJoin(characterTable, eq(postTable.characterId, characterTable.id))
      .where(and(eq(postTable.id, postId), eq(characterTable.status, "active")))
      .limit(1);
    if (!row) {
      return null;
    }
    return (await this.hydratePosts([row]))[0] ?? null;
  }

  async listPostCommentsPage(
    postId: string,
    input: PageInput,
  ): Promise<Page<PostComment>> {
    const cursorId = decodeCursor(input.cursor);
    const visibleAuthor = or(
      isNull(postComments.characterId),
      eq(characterTable.status, "active"),
    );
    const [cursor] = cursorId
      ? await this.database.client
          .select({ createdAt: postComments.createdAt })
          .from(postComments)
          .leftJoin(
            characterTable,
            eq(postComments.characterId, characterTable.id),
          )
          .where(
            and(
              eq(postComments.id, cursorId),
              eq(postComments.postId, postId),
              visibleAuthor,
            ),
          )
          .limit(1)
      : [];
    if (cursorId && !cursor) {
      throw new BadRequestException("Invalid cursor");
    }

    const comments = await this.database.client
      .select({
        id: postComments.id,
        postId: postComments.postId,
        characterId: postComments.characterId,
        userId: postComments.userId,
        body: postComments.body,
        createdAt: postComments.createdAt,
      })
      .from(postComments)
      .leftJoin(characterTable, eq(postComments.characterId, characterTable.id))
      .where(
        and(
          eq(postComments.postId, postId),
          visibleAuthor,
          cursor && cursorId
            ? this.cursorCondition(
                postComments.createdAt,
                postComments.id,
                cursor.createdAt,
                cursorId,
              )
            : undefined,
        ),
      )
      .orderBy(desc(postComments.createdAt), desc(postComments.id))
      .limit(input.limit + 1);
    return pageFromRows(
      comments.map((comment) => this.toPostComment(comment)),
      input.limit,
    );
  }

  async createUserComment(input: {
    postId: string;
    userId: string;
    body: unknown;
  }): Promise<PostComment> {
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) {
      throw new BadRequestException("Comment body is required");
    }

    const [comment] = await this.database.client
      .insert(postComments)
      .values({ postId: input.postId, userId: input.userId, body })
      .returning();
    return this.toPostComment(comment);
  }

  async listPostReactions(
    postId: string,
  ): Promise<{ items: PostReaction[]; counts: Record<string, number> }> {
    const reactions = await this.database.client
      .select({
        id: postReactions.id,
        postId: postReactions.postId,
        characterId: postReactions.characterId,
        userId: postReactions.userId,
        reactionType: postReactions.reactionType,
        createdAt: postReactions.createdAt,
      })
      .from(postReactions)
      .leftJoin(
        characterTable,
        eq(postReactions.characterId, characterTable.id),
      )
      .where(
        and(
          eq(postReactions.postId, postId),
          or(
            isNull(postReactions.characterId),
            eq(characterTable.status, "active"),
          ),
        ),
      )
      .orderBy(desc(postReactions.createdAt), desc(postReactions.id));
    const items = reactions.map((reaction) => this.toPostReaction(reaction));
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
    reactionType: unknown;
  }): Promise<PostReaction> {
    const reactionType = this.requiredReactionType(input.reactionType);
    const [reaction] = await this.database.client
      .insert(postReactions)
      .values({
        postId: input.postId,
        userId: input.userId,
        reactionType,
      })
      .onConflictDoUpdate({
        target: [
          postReactions.postId,
          postReactions.userId,
          postReactions.reactionType,
        ],
        set: { reactionType },
      })
      .returning();
    return this.toPostReaction(reaction);
  }

  async deleteUserReaction(input: {
    postId: string;
    userId: string;
    reactionType: unknown;
  }): Promise<{
    postId: string;
    userId: string;
    reactionType: string;
    deleted: boolean;
  }> {
    const reactionType = this.requiredReactionType(input.reactionType);
    const deleted = await this.database.client
      .delete(postReactions)
      .where(
        and(
          eq(postReactions.postId, input.postId),
          eq(postReactions.userId, input.userId),
          eq(postReactions.reactionType, reactionType),
        ),
      )
      .returning({ id: postReactions.id });
    return {
      postId: input.postId,
      userId: input.userId,
      reactionType,
      deleted: deleted.length > 0,
    };
  }

  private async listPostsWithConditionsPage(
    conditions: SQL[],
    input: PageInput,
  ): Promise<Page<Post>> {
    const cursorId = decodeCursor(input.cursor);
    const [cursor] = cursorId
      ? await this.database.client
          .select({ createdAt: postTable.createdAt })
          .from(postTable)
          .innerJoin(
            characterTable,
            eq(postTable.characterId, characterTable.id),
          )
          .where(and(eq(postTable.id, cursorId), ...conditions))
          .limit(1)
      : [];
    if (cursorId && !cursor) {
      throw new BadRequestException("Invalid cursor");
    }

    const rows = await this.database.client
      .select(postFields)
      .from(postTable)
      .innerJoin(characterTable, eq(postTable.characterId, characterTable.id))
      .where(
        and(
          ...conditions,
          cursor && cursorId
            ? this.cursorCondition(
                postTable.createdAt,
                postTable.id,
                cursor.createdAt,
                cursorId,
              )
            : undefined,
        ),
      )
      .orderBy(desc(postTable.createdAt), desc(postTable.id))
      .limit(input.limit + 1);
    return pageFromRows(await this.hydratePosts(rows), input.limit);
  }

  private postConditions(input: PostFilters): SQL[] {
    const conditions: SQL[] = [eq(characterTable.status, "active")];
    if (input.characterId?.trim()) {
      const characterId = input.characterId.trim();
      if (!isUuid(characterId)) {
        throw new BadRequestException("Invalid character ID");
      }
      conditions.push(eq(postTable.characterId, characterId));
    }
    if (input.contentType) {
      if (input.contentType !== "feed" && input.contentType !== "reel") {
        throw new BadRequestException("Invalid content type");
      }
      conditions.push(eq(postTable.contentType, input.contentType));
    }
    if (input.hashtag?.trim()) {
      const hashtag = input.hashtag.trim();
      conditions.push(
        exists(
          this.database.client
            .select({ value: sql`1` })
            .from(postHashtags)
            .innerJoin(
              hashtagTable,
              eq(postHashtags.hashtagId, hashtagTable.id),
            )
            .where(
              and(
                eq(postHashtags.postId, postTable.id),
                eq(hashtagTable.name, hashtag),
              ),
            ),
        ),
      );
    }
    if (input.mediaType) {
      if (input.mediaType !== "image" && input.mediaType !== "video") {
        throw new BadRequestException("Invalid media type");
      }
      conditions.push(
        exists(
          this.database.client
            .select({ value: sql`1` })
            .from(postMedia)
            .innerJoin(mediaTable, eq(postMedia.mediaId, mediaTable.id))
            .where(
              and(
                eq(postMedia.postId, postTable.id),
                eq(mediaTable.mediaType, input.mediaType),
              ),
            ),
        ),
      );
    }
    return conditions;
  }

  private async hydratePosts(rows: PostRow[]): Promise<Post[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((post) => post.id);
    const [mediaRows, hashtagRows] = await Promise.all([
      this.database.client
        .select({
          postId: postMedia.postId,
          mediaType: mediaTable.mediaType,
          url: mediaTable.url,
          storageKey: mediaTable.storageKey,
          width: mediaTable.width,
          height: mediaTable.height,
          durationSeconds: mediaTable.durationSeconds,
        })
        .from(postMedia)
        .innerJoin(mediaTable, eq(postMedia.mediaId, mediaTable.id))
        .where(inArray(postMedia.postId, ids))
        .orderBy(asc(postMedia.sortOrder)),
      this.database.client
        .select({ postId: postHashtags.postId, name: hashtagTable.name })
        .from(postHashtags)
        .innerJoin(hashtagTable, eq(postHashtags.hashtagId, hashtagTable.id))
        .where(inArray(postHashtags.postId, ids))
        .orderBy(asc(hashtagTable.name)),
    ]);

    return rows.map((post) => ({
      id: post.id,
      characterId: post.characterId,
      contentType: post.contentType,
      content: post.content,
      media: mediaRows
        .filter((media) => media.postId === post.id)
        .map((media) => ({
          mediaType: media.mediaType,
          url: publicMediaUrl(media),
          ...(media.width ? { width: media.width } : {}),
          ...(media.height ? { height: media.height } : {}),
          ...(media.durationSeconds
            ? { durationSeconds: media.durationSeconds }
            : {}),
        })),
      hashtags: hashtagRows
        .filter((hashtag) => hashtag.postId === post.id)
        .map((hashtag) => hashtag.name),
      createdAt: post.createdAt.toISOString(),
    }));
  }

  private cursorCondition(
    createdAtColumn: SQLWrapper,
    idColumn: SQLWrapper,
    createdAt: Date,
    id: string,
  ): SQL {
    return sql`(${createdAtColumn} < ${createdAt} OR (${createdAtColumn} = ${createdAt} AND ${idColumn} < ${id}))`;
  }

  private toPostComment(comment: PostCommentRow): PostComment {
    return {
      id: comment.id,
      postId: comment.postId,
      ...(comment.characterId ? { characterId: comment.characterId } : {}),
      ...(comment.userId ? { userId: comment.userId } : {}),
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  private toPostReaction(reaction: PostReactionRow): PostReaction {
    return {
      id: reaction.id,
      postId: reaction.postId,
      ...(reaction.characterId ? { characterId: reaction.characterId } : {}),
      ...(reaction.userId ? { userId: reaction.userId } : {}),
      reactionType: reaction.reactionType,
      createdAt: reaction.createdAt.toISOString(),
    };
  }

  private requiredReactionType(reactionType: unknown): string {
    const trimmed = typeof reactionType === "string" ? reactionType.trim() : "";
    if (!trimmed) {
      throw new BadRequestException("Reaction type is required");
    }
    return trimmed;
  }
}
