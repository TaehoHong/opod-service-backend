import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { PostsService } from "../../domain/posts/posts.service";
import { parsePageQuery } from "../../domain/database/page";

@Controller("posts")
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  listPosts(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("characterId") characterId?: string,
    @Query("hashtag") hashtag?: string,
    @Query("mediaType") mediaType?: "image" | "video",
  ) {
    return this.postsService.listPostsPage({
      ...parsePageQuery(cursor, limit),
      characterId,
      hashtag,
      mediaType,
    });
  }

  @Get(":id/comments")
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

  @Get(":id/reactions")
  async listPostReactions(@Param("id") postId: string) {
    if (!(await this.postsService.hasPost(postId))) {
      throw new NotFoundException("Post not found");
    }
    return this.postsService.listPostReactions(postId);
  }

  @Get(":id")
  async getPost(@Param("id") postId: string) {
    const post = await this.postsService.findPost(postId);
    if (!post) {
      throw new NotFoundException("Post not found");
    }
    return post;
  }
}
