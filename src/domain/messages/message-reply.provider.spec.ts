import { createMessageReplyProvider } from "./message-reply.provider";

describe("message reply provider", () => {
  it("calls a configured OpenAI-compatible chat completions endpoint", async () => {
    const fetchReply = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "provider says hi" } }],
        }),
    });
    const provider = createMessageReplyProvider(
      {
        LLM_API_URL: "https://llm.local/v1/chat/completions",
        LLM_API_KEY: "secret-token",
        LLM_MODEL: "chat-mini",
      },
      fetchReply,
    );

    await expect(
      provider.createReply({
        userId: "human-1",
        characterId: "ai-1",
        messageBody: "hello",
      }),
    ).resolves.toBe("provider says hi");

    expect(fetchReply).toHaveBeenCalledWith(
      "https://llm.local/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
        },
      }),
    );
    const requestBody = JSON.parse(fetchReply.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: "chat-mini",
      messages: [
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "hello" },
      ],
    });
  });
});
