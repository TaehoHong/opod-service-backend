import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { users } from "../database/schema";

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  async hasUser(userId: string): Promise<boolean> {
    const [user] = await this.database.client
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user !== undefined;
  }
}
