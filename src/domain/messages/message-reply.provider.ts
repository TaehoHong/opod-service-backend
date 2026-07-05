import { ServiceUnavailableException } from "@nestjs/common";

export type MessageReplyInput = {
  userId: string;
  characterId: string;
  messageBody: string;
};

export type MessageReplyProvider = {
  createReply(input: MessageReplyInput): Promise<string>;
};

export const MESSAGE_REPLY_PROVIDER = Symbol("MESSAGE_REPLY_PROVIDER");

export const localMessageReplyProvider: MessageReplyProvider = {
  createReply(input) {
    return Promise.resolve(`AI reply to: ${input.messageBody}`);
  },
};

type MessageReplyEnv = Record<string, string | undefined>;

export function createMessageReplyProvider(
  env: MessageReplyEnv = process.env,
  fetchReply: typeof fetch = fetch,
): MessageReplyProvider {
  const apiUrl = env.LLM_API_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();

  if (!apiUrl || !apiKey || !model) {
    return localMessageReplyProvider;
  }

  return {
    async createReply(input) {
      try {
        const response = await fetchReply(apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "You are a character replying in a 1:1 SNS message. Reply concisely.",
              },
              { role: "user", content: input.messageBody },
            ],
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
