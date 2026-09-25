import { Injectable } from "@nestjs/common";
import { CharacterService } from "../characters/character.service";
import { PostReactionService } from "../posts/post-reaction.service";
import { CharacterFollowRepository } from "./character-follow.repository";

@Injectable()
export class CharacterFollowService {
  constructor(
    private readonly repository: CharacterFollowRepository,
    private readonly reactions: PostReactionService,
    private readonly characters: CharacterService,
  ) {}

  countDaily(characterId: string, dayStart: Date, dayEnd: Date) {
    return this.repository.count(characterId, dayStart, dayEnd);
  }

  async followQualifiedAuthors(input: {
    characterId: string;
    threshold: number;
    limit: number;
    now: Date;
  }) {
    if (input.limit <= 0) return;
    const selected: string[] = [];
    let cursor: string | null = null;
    while (selected.length < input.limit) {
      const page = await this.reactions.findLikedAuthorCounts(
        input.characterId,
        cursor,
        100,
      );
      if (page.length === 0) break;
      cursor = page[page.length - 1].authorId;
      const qualified = page
        .filter((item) => item.distinctPostCount >= input.threshold)
        .map((item) => item.authorId);
      const active = await this.characters.findActiveIds(qualified);
      const existing = await this.repository.findExisting(
        input.characterId,
        qualified,
      );
      selected.push(
        ...qualified
          .filter((id) => active.has(id) && !existing.has(id))
          .slice(0, input.limit - selected.length),
      );
      if (page.length < 100) break;
    }
    await this.repository.insert(input.characterId, selected, input.now);
  }
}
