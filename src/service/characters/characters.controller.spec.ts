import { AuthService } from "../../domain/auth/auth.service";
import { CharactersService } from "../../domain/characters/characters.service";
import { FollowsService } from "../../domain/follows/follows.service";
import { PostsService } from "../../domain/posts/posts.service";
import { StoriesService } from "../../domain/stories/stories.service";
import { CharactersController } from "./characters.controller";

describe("CharactersController", () => {
  it("passes character story queries to the stories service", async () => {
    const listCharacterStoriesPage = jest.fn().mockResolvedValue({ items: [] });
    const controller = new CharactersController(
      {
        hasCharacter: jest.fn().mockResolvedValue(true),
      } as unknown as CharactersService,
      {} as PostsService,
      {} as AuthService,
      {} as FollowsService,
      { listCharacterStoriesPage } as unknown as StoriesService,
    );

    await controller.listCharacterStories("character-1", undefined, "10");

    expect(listCharacterStoriesPage).toHaveBeenCalledWith("character-1", {
      limit: 10,
    });
  });
});
