import { Injectable } from "@nestjs/common";
import { CharacterRepository } from "./character.repository";

@Injectable()
export class CharacterService {
  constructor(private readonly repository: CharacterRepository) {}

  withActivityTransaction<T>(characterId: string, work: () => Promise<T>) {
    return this.repository.withActivityTransaction(characterId, work);
  }

  findActivityContext(characterId: string, now: Date) {
    return this.repository.findActivityContext(characterId, now);
  }

  findActiveIds(characterIds: string[]) {
    return this.repository.findActiveIds(characterIds);
  }
}
