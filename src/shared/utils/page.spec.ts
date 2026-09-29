import { BadRequestException } from "@nestjs/common";
import { decodeCursor } from "./page";

describe("decodeCursor", () => {
  it("rejects cursors whose database ID is not a UUID", () => {
    const cursor = Buffer.from(JSON.stringify({ id: "bad-id" })).toString(
      "base64url",
    );

    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
  });
});
