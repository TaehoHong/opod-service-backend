import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function listFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe("source layout", () => {
  it("keeps feature code under service or domain", () => {
    const allowedRootEntries = new Set([
      "app.module.ts",
      "architecture.spec.ts",
      "domain",
      "main.ts",
      "service",
    ]);

    const entries = readdirSync("src").filter(
      (entry) => !entry.endsWith(".js"),
    );

    expect(entries.sort()).toEqual([...allowedRootEntries].sort());
  });

  it("keeps the service backend at the repository root", () => {
    const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
      name?: string;
      workspaces?: string[];
      dependencies?: Record<string, string>;
    };

    expect(rootPackage.name).toBe("opod-service-backend");
    expect(rootPackage.workspaces).toBeUndefined();
    expect(rootPackage.dependencies?.["@nestjs/core"]).toBeDefined();
    expect(existsSync("packages/admin")).toBe(false);
    expect(existsSync("src/admin")).toBe(false);
  });

  it("keeps domain folders aligned with database groups", () => {
    const expectedDomainEntries = [
      "auth",
      "characters",
      "credits",
      "database",
      "events",
      "faqs",
      "feed",
      "follows",
      "inquiries",
      "media",
      "messages",
      "notices",
      "notifications",
      "posts",
      "reports",
      "stories",
      "users",
    ];

    const entries = readdirSync("src/domain").filter(
      (entry) => !entry.endsWith(".js"),
    );

    expect(entries.sort()).toEqual(expectedDomainEntries.sort());
  });

  it("keeps HTTP controllers out of shared domain modules", () => {
    const domainControllers = listFiles("src/domain").filter((path) =>
      path.endsWith(".controller.ts"),
    );

    expect(domainControllers).toEqual([]);
  });

  it("keeps service routes independent from admin modules", () => {
    const serviceSources = listFiles("src/service").filter((path) =>
      path.endsWith(".ts"),
    );

    expect(serviceSources.length).toBeGreaterThan(0);
    for (const path of serviceSources) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/from\s+["'].*admin/);
    }
  });

  it("keeps persistence on the current Prisma path only", () => {
    const removedFiles = [
      "database/migrations/001_mvp_schema.sql",
      "src/domain/database/database.module.ts",
      "src/domain/database/database.service.spec.ts",
      "src/domain/database/database.service.ts",
      "src/domain/generation/generation.service.ts",
      "src/domain/media/media.service.ts",
      "src/domain/users/users.controller.ts",
    ];

    expect(removedFiles.filter((path) => existsSync(path))).toEqual([]);

    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of [
      "@types/express",
      "@types/pg",
      "pg",
      "source-map-support",
      "testcontainers",
      "ts-loader",
    ]) {
      expect(deps[name]).toBeUndefined();
    }

    for (const path of [
      "src/domain/auth/auth.service.ts",
      "src/domain/characters/characters.service.ts",
      "src/domain/credits/credits.service.ts",
      "src/domain/events/events.service.ts",
      "src/domain/feed/feed.service.ts",
      "src/domain/follows/follows.service.ts",
      "src/domain/messages/messages.service.ts",
      "src/domain/notifications/notifications.service.ts",
      "src/domain/posts/posts.service.ts",
      "src/domain/reports/reports.service.ts",
      "src/domain/users/users.service.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("DB-free fallback");
      expect(source).not.toContain("@Inject(PrismaService)");
      expect(source).not.toMatch(/type \w+PrismaClient =/);
      expect(source).not.toMatch(/private readonly \w+: .*?\[\] = \[\]/);
    }
  });

  it("uses UUIDv7 defaults for UUID primary keys", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const uuidPrimaryKeys = schema
      .split("\n")
      .filter((line) => line.includes("@id"))
      .filter((line) => line.includes("@db.Uuid"));

    expect(uuidPrimaryKeys.length).toBeGreaterThan(0);
    expect(schema).not.toContain("@default(uuid())");
    for (const line of uuidPrimaryKeys) {
      if (line.includes("@default(")) {
        expect(line).toContain("@default(uuid(7))");
      }
    }
  });
});
