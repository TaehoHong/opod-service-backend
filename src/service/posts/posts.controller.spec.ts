import { PostsService } from "../../domain/posts/posts.service";
import { AuthService } from "../../domain/auth/auth.service";
import { PostsController } from "./posts.controller";

describe("PostsController", () => {
  it("passes content type query to the posts service", () => {
    const listPostsPage = jest.fn().mockReturnValue({ items: [] });
    const controller = new PostsController(
      {
        listPostsPage,
      } as unknown as PostsService,
      {} as AuthService,
    );

    controller.listPosts(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "reel",
    );

    expect(listPostsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        contentType: "reel",
      }),
    );
  });

  it("creates post comments for the authenticated user", async () => {
    const createUserComment = jest.fn().mockResolvedValue({
      id: "comment-1",
    });
    const controller = new PostsController(
      {
        createUserComment,
        hasPost: jest.fn().mockResolvedValue(true),
      } as unknown as PostsService,
      {
        userIdFromAuthorization: jest.fn().mockResolvedValue("user-1"),
      } as unknown as AuthService,
    );

    await controller.createPostComment("post-1", "Bearer token", {
      body: " hello ",
    });

    expect(createUserComment).toHaveBeenCalledWith({
      postId: "post-1",
      userId: "user-1",
      body: " hello ",
    });
  });

  it("passes a missing post comment body to domain validation", async () => {
    const createUserComment = jest.fn().mockResolvedValue({ id: "comment-1" });
    const controller = new PostsController(
      {
        createUserComment,
        hasPost: jest.fn().mockResolvedValue(true),
      } as unknown as PostsService,
      {
        userIdFromAuthorization: jest.fn().mockResolvedValue("user-1"),
      } as unknown as AuthService,
    );

    await controller.createPostComment(
      "post-1",
      "Bearer token",
      undefined as never,
    );

    expect(createUserComment).toHaveBeenCalledWith({
      postId: "post-1",
      userId: "user-1",
      body: undefined,
    });
  });

  it("creates post reactions for the authenticated user", async () => {
    const createUserReaction = jest.fn().mockResolvedValue({
      id: "reaction-1",
    });
    const controller = new PostsController(
      {
        createUserReaction,
        hasPost: jest.fn().mockResolvedValue(true),
      } as unknown as PostsService,
      {
        userIdFromAuthorization: jest.fn().mockResolvedValue("user-1"),
      } as unknown as AuthService,
    );

    await controller.createPostReaction("post-1", "Bearer token", {
      reactionType: "like",
    });

    expect(createUserReaction).toHaveBeenCalledWith({
      postId: "post-1",
      userId: "user-1",
      reactionType: "like",
    });
  });

  it("passes a missing post reaction body to domain validation", async () => {
    const createUserReaction = jest
      .fn()
      .mockResolvedValue({ id: "reaction-1" });
    const controller = new PostsController(
      {
        createUserReaction,
        hasPost: jest.fn().mockResolvedValue(true),
      } as unknown as PostsService,
      {
        userIdFromAuthorization: jest.fn().mockResolvedValue("user-1"),
      } as unknown as AuthService,
    );

    await controller.createPostReaction(
      "post-1",
      "Bearer token",
      undefined as never,
    );

    expect(createUserReaction).toHaveBeenCalledWith({
      postId: "post-1",
      userId: "user-1",
      reactionType: undefined,
    });
  });

  it("deletes post reactions for the authenticated user", async () => {
    const deleteUserReaction = jest.fn().mockResolvedValue({ deleted: true });
    const controller = new PostsController(
      {
        deleteUserReaction,
        hasPost: jest.fn().mockResolvedValue(true),
      } as unknown as PostsService,
      {
        userIdFromAuthorization: jest.fn().mockResolvedValue("user-1"),
      } as unknown as AuthService,
    );

    await controller.deletePostReaction("post-1", "Bearer token", {
      reactionType: "like",
    });

    expect(deleteUserReaction).toHaveBeenCalledWith({
      postId: "post-1",
      userId: "user-1",
      reactionType: "like",
    });
  });

  it("passes a missing delete-reaction body to domain validation", async () => {
    const deleteUserReaction = jest.fn().mockResolvedValue({ deleted: true });
    const controller = new PostsController(
      {
        deleteUserReaction,
        hasPost: jest.fn().mockResolvedValue(true),
      } as unknown as PostsService,
      {
        userIdFromAuthorization: jest.fn().mockResolvedValue("user-1"),
      } as unknown as AuthService,
    );

    await controller.deletePostReaction(
      "post-1",
      "Bearer token",
      undefined as never,
    );

    expect(deleteUserReaction).toHaveBeenCalledWith({
      postId: "post-1",
      userId: "user-1",
      reactionType: undefined,
    });
  });
});
