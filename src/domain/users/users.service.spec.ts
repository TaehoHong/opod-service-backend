import { UsersService } from "./users.service";

describe("UsersService", () => {
  it("checks users through Prisma", async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: "user-1" });
    const service = new (
      UsersService as unknown as new (client: unknown) => UsersService
    )({
      user: { findUnique },
    });

    await expect(service.hasUser("user-1")).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true },
    });
  });
});
