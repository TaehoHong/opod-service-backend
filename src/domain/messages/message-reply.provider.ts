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

/**
 * The Agent answers only after the model has finished generating, so this wait
 * covers a whole turn — not a handshake. A local model (MLX/Ollama) loads its
 * weights on the first request and can sit silent past a minute before the first
 * token, which is why the default is minutes rather than seconds: cutting the
 * request there costs the reply *and* the credits already reserved for it.
 *
 * Deployments fronted by a fast hosted model should turn this down via
 * OPOD_AGENT_TIMEOUT_MS — a stuck upstream otherwise holds the request open.
 */
const DEFAULT_REPLY_TIMEOUT_MS = 300_000;

function replyTimeoutMs(env: MessageReplyEnv): number {
  const configured = Number(env.OPOD_AGENT_TIMEOUT_MS);
  // Number("") is 0 and Number(undefined) is NaN — both mean "unset" here, and
  // a zero or negative timeout would abort every turn instantly.
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_REPLY_TIMEOUT_MS;
}

export function createMessageReplyProvider(
  env: MessageReplyEnv = process.env,
  fetchReply: typeof fetch = fetch,
): MessageReplyProvider {
  const apiUrl = env.OPOD_AGENT_URL?.trim();

  if (!apiUrl) {
    throw new Error("OPOD_AGENT_URL is required");
  }

  const timeoutMs = replyTimeoutMs(env);

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
          signal: AbortSignal.timeout(timeoutMs),
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
