import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { PostsService } from "../../domain/posts/posts.service";
import { AuthService } from "../../domain/auth/auth.service";
import { parsePageQuery } from "../../domain/database/page";
import {
  CreatePostCommentDto,
  PostCommentPageDto,
  PostCommentDto,
  PostDto,
  PostPageDto,
  PostReactionDeleteDto,
  PostReactionDto,
  PostReactionRequestDto,
  PostReactionsDto,
} from "./post.dto";

@Controller("posts")
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "characterId", required: false })
  @ApiQuery({ name: "hashtag", required: false })
  @ApiQuery({ name: "mediaType", required: false, enum: ["image", "video"] })
  @ApiQuery({ name: "contentType", required: false, enum: ["feed", "reel"] })
  @ApiOkResponse({ type: PostPageDto })
  listPosts(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("characterId") characterId?: string,
    @Query("hashtag") hashtag?: string,
    @Query("mediaType") mediaType?: "image" | "video",
    @Query("contentType") contentType?: "feed" | "reel",
  ) {
    return this.postsService.listPostsPage({
      ...parsePageQuery(cursor, limit),
      characterId,
      contentType,
      hashtag,
      mediaType,
    });
  }

  @Get(":id/comments")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ type: PostCommentPageDto })
  async listPostComments(
    @Param("id") postId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    if (!(await this.postsService.hasPost(postId))) {
      throw new NotFoundException("Post not found");
    }
    return this.postsService.listPostCommentsPage(
      postId,
      parsePageQuery(cursor, limit),
    );
  }

  @Post(":id/comments")
  @ApiCreatedResponse({ type: PostCommentDto })
  async createPostComment(
    @Param("id") postId: string,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreatePostCommentDto,
  ) {
    if (!(await this.postsService.hasPost(postId))) {
      throw new NotFoundException("Post not found");
    }
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.postsService.createUserComment({
      postId,
      userId,
      body: body.body,
    });
  }

  @Get(":id/reactions")
  @ApiOkResponse({ type: PostReactionsDto })
  async listPostReactions(@Param("id") postId: string) {
    if (!(await this.postsService.hasPost(postId))) {
      throw new NotFoundException("Post not found");
    }
    return this.postsService.listPostReactions(postId);
  }

  @Post(":id/reactions")
  @ApiCreatedResponse({ type: PostReactionDto })
  async createPostReaction(
    @Param("id") postId: string,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: PostReactionRequestDto,
  ) {
    if (!(await this.postsService.hasPost(postId))) {
      throw new NotFoundException("Post not found");
    }
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.postsService.createUserReaction({
      postId,
      userId,
      reactionType: body.reactionType,
    });
  }

  @Delete(":id/reactions")
  @ApiOkResponse({ type: PostReactionDeleteDto })
  async deletePostReaction(
    @Param("id") postId: string,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: PostReactionRequestDto,
  ) {
    if (!(await this.postsService.hasPost(postId))) {
      throw new NotFoundException("Post not found");
    }
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.postsService.deleteUserReaction({
      postId,
      userId,
      reactionType: body.reactionType,
    });
  }

  @Get(":id")
  @ApiOkResponse({ type: PostDto })
  async getPost(@Param("id") postId: string) {
    const post = await this.postsService.findPost(postId);
    if (!post) {
      throw new NotFoundException("Post not found");
    }
    return post;
  }
}
