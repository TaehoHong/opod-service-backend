import { createMessageReplyProvider } from "./message-reply.provider";

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
