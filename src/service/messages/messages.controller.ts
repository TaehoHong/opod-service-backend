import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { MessagesService } from "../../domain/messages/messages.service";
import { parsePageQuery } from "../../domain/database/page";

@Controller("messages")
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  async sendMessage(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Parameters<MessagesService["sendMessage"]>[0],
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.messagesService.sendMessage({ ...body, userId });
  }

  @Get("conversations")
  async listConversations(
    @Headers("authorization") authorization: string | undefined,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.messagesService.listConversationsPage({
      userId,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get()
  async getMessages(
    @Headers("authorization") authorization: string | undefined,
    @Query("characterId") characterId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.messagesService.getMessagesPage({
      userId,
      characterId,
      ...parsePageQuery(cursor, limit),
    });
  }
}
