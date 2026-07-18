import { ServiceUnavailableException } from "@nestjs/common";

export type MessageReplyInput = {
  userId: string;
  characterId: string;
  conversationId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  turnId: string;
};

export type MessageReplyProvider = {
  createReply(input: MessageReplyInput): Promise<string>;
};

export const MESSAGE_REPLY_PROVIDER = Symbol("MESSAGE_REPLY_PROVIDER");

type MessageReplyEnv = Record<string, string | undefined>;

export function createMessageReplyProvider(
  env: MessageReplyEnv = process.env,
  fetchReply: typeof fetch = fetch,
): MessageReplyProvider {
  const apiUrl = env.OPOD_AGENT_URL?.trim();

  if (!apiUrl) {
    throw new Error("OPOD_AGENT_URL is required");
  }

  return {
    async createReply(input) {
      try {
        const response = await fetchReply(apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opod-character-id": input.characterId,
            "x-opod-history-offset": "0",
            "x-opod-session-id": input.conversationId,
            "x-opod-turn-id": input.turnId,
            "x-opod-user-id": input.userId,
          },
          body: JSON.stringify({
            messages: input.messages,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          throw new ServiceUnavailableException("LLM reply provider failed");
        }

        const reply = contentFromChatCompletion(await response.json());
        if (!reply) {
          throw new ServiceUnavailableException("LLM reply provider failed");
        }

        return reply;
      } catch (error) {
        if (error instanceof ServiceUnavailableException) {
          throw error;
        }
        throw new ServiceUnavailableException("LLM reply provider failed");
      }
    },
  };
}

function contentFromChatCompletion(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const choices = value.choices;
  if (!Array.isArray(choices)) {
    return null;
  }
  const first = choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return null;
  }
  const content = first.message.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
