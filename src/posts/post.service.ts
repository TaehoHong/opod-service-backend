import { Injectable } from "@nestjs/common";
import { PostRepository } from "./post.repository";

@Injectable()
export class PostService {
  constructor(private readonly repository: PostRepository) {}

  findSocialCandidates(input: {
    characterId: string;
    interests: string[];
    now: Date;
    limit: number;
  }) {
    const interests = input.interests
      .map((value) => value.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean);
    return this.repository.findSocialCandidates({ ...input, interests });
  }
}
