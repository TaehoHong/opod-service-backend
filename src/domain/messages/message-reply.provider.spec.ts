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
});
