import { AuthService } from "../../domain/auth/auth.service";
import { EventsService } from "../../domain/events/events.service";
import { EventsController } from "./events.controller";

describe("EventsController", () => {
  it("records a client event with the authenticated user identity", async () => {
    const recordClientEvent = jest.fn().mockResolvedValue({ accepted: true });
    const recordEvent = jest.fn().mockResolvedValue({ accepted: true });
    const controller = new EventsController(
      { recordClientEvent, recordEvent } as unknown as EventsService,
      {
        userIdFromAuthorization: jest
          .fn()
          .mockResolvedValue("authenticated-user"),
      } as unknown as AuthService,
    );
    const body = {
      eventType: "post_open",
      targetType: "post",
      targetId: "00000000-0000-7000-8000-000000000011",
      metadata: { source: "feed" },
    };

    await expect(
      controller.recordEvent("Bearer token", body as never),
    ).resolves.toEqual({ accepted: true });
    expect(recordClientEvent).toHaveBeenCalledWith("authenticated-user", body);
    expect(recordEvent).not.toHaveBeenCalled();
  });
});
