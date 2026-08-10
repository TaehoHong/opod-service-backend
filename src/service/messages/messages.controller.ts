import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
} from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { MessagesService } from "../../domain/messages/messages.service";
import { parsePageQuery } from "../../domain/database/page";
import {
  MarkConversationReadDto,
  RetryReplyDto,
  SendMessageDto,
} from "./message.dto";

@Controller("messages")
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  async sendMessage(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: SendMessageDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.messagesService.sendMessage({ ...body, userId });
  }

  // 답변 작업을 다시 큐에 넣기만 하므로 202다. 실제 답변은 워커가 만든다.
  @Post("retry")
  @HttpCode(202)
  async retryReply(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: RetryReplyDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.messagesService.retryReply({ ...body, userId });
  }

  @Post("read")
  async markConversationRead(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: MarkConversationReadDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.messagesService.markConversationRead({ ...body, userId });
  }

  @Get("conversations")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
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
  @ApiQuery({ name: "characterId", required: true })
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
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
