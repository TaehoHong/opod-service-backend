import { OAuth2Client } from "google-auth-library";
import { GooglePlayIapProvider } from "./google-play-iap.provider";

describe("GooglePlayIapProvider Pub/Sub authentication", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GOOGLE_PLAY_PACKAGE_NAME: "com.example.opod",
      GOOGLE_PLAY_PUBSUB_AUDIENCE: "https://api.example.com/payments/google",
      GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT:
        "play-events@example-project.iam.gserviceaccount.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function request() {
    const notification = Buffer.from(
      JSON.stringify({ packageName: "com.example.opod", testNotification: {} }),
    ).toString("base64");
    return {
      body: Buffer.from(
        JSON.stringify({
          message: { messageId: "message-1", data: notification },
        }),
      ),
      headers: { authorization: "Bearer signed-token" },
    };
  }

  it("rejects a valid Google token issued for an unexpected service account", async () => {
    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({
        email: "attacker@example-project.iam.gserviceaccount.com",
        email_verified: true,
      }),
    } as never);

    await expect(
      new GooglePlayIapProvider().verifyEvent(request()),
    ).rejects.toThrow("Invalid provider signature");
  });

  it("accepts the configured verified Pub/Sub service account", async () => {
    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({
        email: "play-events@example-project.iam.gserviceaccount.com",
        email_verified: true,
      }),
    } as never);

    await expect(
      new GooglePlayIapProvider().verifyEvent(request()),
    ).resolves.toMatchObject({ eventId: "message-1", type: "ignored" });
  });
});
