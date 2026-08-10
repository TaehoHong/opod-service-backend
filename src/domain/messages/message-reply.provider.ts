/**
 * Agent 호출 실패. `retryable`이 워커의 재시도 여부를 가른다 — 같은 요청을 세 번
 * 보내도 결과가 같을 실패(계약 불일치, 4xx)까지 재시도하면 크레딧을 잡아둔 채
 * 시간만 쓴다. `reason`은 내부 분류라 사용자에게 노출하지 않는다.
 */
export class MessageReplyError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
  ) {
    super(`LLM reply provider failed: ${reason}`);
    this.name = "MessageReplyError";
  }
}

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
      let response: Awaited<ReturnType<typeof fetch>>;
      try {
        response = await fetchReply(apiUrl, {
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
      } catch (error) {
        // 연결 실패와 timeout은 둘 다 다음 시도에 성공할 수 있다.
        throw new MessageReplyError(abortReason(error) ?? "network", true);
      }

      if (!response.ok) {
        // 4xx는 같은 요청을 다시 보내도 같은 답이라 재시도하지 않는다. 429는
        // 지금 몰린 것뿐이라 예외다.
        const retryable = response.status >= 500 || response.status === 429;
        throw new MessageReplyError(`http_${response.status}`, retryable);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new MessageReplyError("unreadable_body", true);
      }

      const parsed = contentFromChatCompletion(payload);
      if (parsed === "malformed") {
        // choices 자체가 없다 = 응답 계약이 어긋났다. 재시도해도 같다.
        throw new MessageReplyError("invalid_response", false);
      }
      if (!parsed) {
        // 형식은 맞는데 내용이 비었다 = 생성이 헛돈 것. 다시 시도할 값이 있다.
        throw new MessageReplyError("empty_reply", true);
      }

      return parsed;
    },
  };
}

function abortReason(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  return error.name === "TimeoutError" || error.name === "AbortError"
    ? "timeout"
    : null;
}

function contentFromChatCompletion(
  value: unknown,
): string | "malformed" | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return "malformed";
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return "malformed";
  }
  const content = first.message.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
