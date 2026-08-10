import {
  createMessageReplyProvider,
  MessageReplyError,
} from "./message-reply.provider";

describe("message reply provider", () => {
  it("calls the configured OPOD agent endpoint", async () => {
    const fetchReply = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "provider says hi" } }],
        }),
    });
    const provider = createMessageReplyProvider(
      { OPOD_AGENT_URL: "https://agent.local/v1/chat/completions" },
      fetchReply,
    );

    await expect(
      provider.createReply({
        userId: "human-1",
        characterId: "ai-1",
        conversationId: "conversation-1",
        messages: [
          { role: "user", content: "previous question" },
          { role: "assistant", content: "previous answer" },
          { role: "user", content: "hello" },
        ],
        turnId: "message-human",
      }),
    ).resolves.toBe("provider says hi");

    expect(fetchReply).toHaveBeenCalledWith(
      "https://agent.local/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opod-character-id": "ai-1",
          "x-opod-history-offset": "0",
          "x-opod-session-id": "conversation-1",
          "x-opod-turn-id": "message-human",
          "x-opod-user-id": "human-1",
        },
      }),
    );
    const requestBody = JSON.parse(fetchReply.mock.calls[0][1].body);
    expect(requestBody).toEqual({
      messages: [
        { role: "user", content: "previous question" },
        { role: "assistant", content: "previous answer" },
        { role: "user", content: "hello" },
      ],
    });
  });

  it("requires an OPOD agent URL", () => {
    expect(() => createMessageReplyProvider({})).toThrow(
      "OPOD_AGENT_URL is required",
    );
  });

  describe("failure classification", () => {
    // 워커는 이 플래그로 재시도 여부를 정한다. 잘못 분류하면 영구 실패를 세 번
    // 더 부르거나(크레딧을 잡아둔 채), 회복 가능한 장애를 한 번에 포기한다.
    const failureFor = async (
      fetchReply: jest.Mock,
    ): Promise<MessageReplyError> => {
      const provider = createMessageReplyProvider(
        { OPOD_AGENT_URL: "https://agent.local/v1/chat/completions" },
        fetchReply,
      );
      try {
        await provider.createReply({
          userId: "human-1",
          characterId: "ai-1",
          conversationId: "conversation-1",
          messages: [{ role: "user", content: "hello" }],
          turnId: "message-human",
        });
      } catch (error) {
        return error as MessageReplyError;
      }
      throw new Error("expected the provider to fail");
    };

    const respondWith = (status: number) =>
      jest.fn().mockResolvedValue({
        ok: status < 400,
        status,
        json: () => Promise.resolve({}),
      });

    it("retries a timed out generation", async () => {
      const timeout = Object.assign(new Error("aborted"), {
        name: "TimeoutError",
      });
      const failure = await failureFor(jest.fn().mockRejectedValue(timeout));
      expect(failure).toMatchObject({ reason: "timeout", retryable: true });
    });

    it("retries a connection failure", async () => {
      const failure = await failureFor(
        jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      );
      expect(failure).toMatchObject({ reason: "network", retryable: true });
    });

    it.each([500, 502, 503])("retries upstream %s", async (status) => {
      const failure = await failureFor(respondWith(status));
      expect(failure.retryable).toBe(true);
    });

    it("retries a rate limit because it is about timing, not the request", async () => {
      const failure = await failureFor(respondWith(429));
      expect(failure).toMatchObject({ reason: "http_429", retryable: true });
    });

    it.each([400, 401, 404, 422])(
      "does not retry a rejected request (%s)",
      async (status) => {
        const failure = await failureFor(respondWith(status));
        expect(failure.retryable).toBe(false);
      },
    );

    it("does not retry a response that breaks the contract", async () => {
      const failure = await failureFor(
        jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ unexpected: true }),
        }),
      );
      expect(failure).toMatchObject({
        reason: "invalid_response",
        retryable: false,
      });
    });

    it("retries an empty generation", async () => {
      // 형식은 맞는데 내용이 빈 것은 모델이 헛돈 것이라 다시 시도할 값이 있다.
      const failure = await failureFor(
        jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ choices: [{ message: { content: "  " } }] }),
        }),
      );
      expect(failure).toMatchObject({ reason: "empty_reply", retryable: true });
    });
  });

  describe("reply timeout", () => {
    // The wait covers a whole generation, so the value matters: too low and a
    // cold local model loses the turn *and* the credits reserved for it.
    const timeoutFor = async (
      env: Record<string, string | undefined>,
    ): Promise<number> => {
      const spy = jest.spyOn(AbortSignal, "timeout");
      try {
        const provider = createMessageReplyProvider(
          { OPOD_AGENT_URL: "https://agent.local/v1/chat/completions", ...env },
          jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ choices: [{ message: { content: "hi" } }] }),
          }),
        );
        await provider.createReply({
          userId: "human-1",
          characterId: "ai-1",
          conversationId: "conversation-1",
          messages: [{ role: "user", content: "hello" }],
          turnId: "message-human",
        });
        return spy.mock.calls.at(-1)?.[0] as number;
      } finally {
        spy.mockRestore();
      }
    };

    it("honours OPOD_AGENT_TIMEOUT_MS", async () => {
      await expect(
        timeoutFor({ OPOD_AGENT_TIMEOUT_MS: "45000" }),
      ).resolves.toBe(45000);
    });

    it.each([
      ["unset", undefined],
      ["empty", ""],
      ["not a number", "soon"],
      ["zero", "0"],
      ["negative", "-1"],
    ])("falls back to the default when %s", async (_label, value) => {
      // Zero and negative would abort every turn before it began, so they are
      // treated as unset rather than obeyed.
      await expect(timeoutFor({ OPOD_AGENT_TIMEOUT_MS: value })).resolves.toBe(
        300_000,
      );
    });
  });
});
