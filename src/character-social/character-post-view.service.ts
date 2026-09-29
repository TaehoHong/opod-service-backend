import { Injectable } from "@nestjs/common";
import { CharacterPostViewRepository } from "./character-post-view.repository";

@Injectable()
export class CharacterPostViewService {
  constructor(private readonly repository: CharacterPostViewRepository) {}
  countDaily(characterId: string, dayStart: Date, dayEnd: Date) {
    return this.repository.count(characterId, dayStart, dayEnd);
  }
  record(characterId: string, postIds: string[], now: Date) {
    return this.repository.insert(characterId, postIds, now);
  }
}
