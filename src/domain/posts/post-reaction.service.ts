import { Injectable } from "@nestjs/common";
import { PostReactionRepository } from "./post-reaction.repository";

@Injectable()
export class PostReactionService {
  constructor(private readonly repository: PostReactionRepository) {}

  countDailyLikes(characterId: string, dayStart: Date, dayEnd: Date) {
    return this.repository.countLikes(characterId, dayStart, dayEnd);
  }

  async likeViewedPosts(input: {
    characterId: string;
    postIds: string[];
    probability: number;
    limit: number;
    now: Date;
  }): Promise<void> {
    const selected = input.postIds
      .filter(() => Math.random() < input.probability)
      .slice(0, input.limit);
    await this.repository.insertLikes(input.characterId, selected, input.now);
  }

  findLikedAuthorCounts(
    characterId: string,
    afterAuthorId: string | null,
    limit: number,
  ) {
    return this.repository.findLikedAuthorCounts(
      characterId,
      afterAuthorId,
      limit,
    );
  }
}
