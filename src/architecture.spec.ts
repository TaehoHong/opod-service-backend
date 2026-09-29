import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as ts from "typescript";

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
  it("keeps social activity repositories private to their owning services", () => {
    const scopedRepositories = new Set([
      "character.repository",
      "post.repository",
      "post-reaction.repository",
      "character-post-view.repository",
      "character-follow.repository",
      "character-social-activity-policy.repository",
      "character-social-activity-job.repository",
      "character-social.repository",
    ]);
    const violations: string[] = [];
    for (const path of listFiles("src").filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"),
    )) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const repositoryNames = new Set<string>();
      const isSocialService =
        path.startsWith("src/character-social/") &&
        (path.endsWith(".service.ts") || path.endsWith(".worker.ts"));
      const isOwningService = scopedRepositories.has(
        basename(path).replace(/\.service\.ts$/, ".repository"),
      );
      for (const statement of source.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue;
        const target = statement.moduleSpecifier.text;
        if (
          (isSocialService || isOwningService) &&
          (target === "drizzle-orm" ||
            [
              "database.service",
              "database-transaction-context",
              "schema",
            ].includes(basename(target)))
        ) {
          violations.push(`${path} bypasses its repository through ${target}`);
        }
        if (!scopedRepositories.has(basename(target))) continue;
        const owner = resolve(
          dirname(path),
          target.replace(/\.repository$/, ".service.ts"),
        );
        if (
          basename(target) === "character-social.repository" ||
          (resolve(path) !== owner && !path.endsWith(".module.ts"))
        ) {
          violations.push(`${path} imports ${target} outside its owner`);
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            repositoryNames.add(element.name.text);
          }
        }
      }
      if (path.endsWith(".module.ts")) {
        const inspect = (node: ts.Node): void => {
          if (
            ts.isPropertyAssignment(node) &&
            node.name.getText(source) === "exports"
          ) {
            const inspectExport = (value: ts.Node): void => {
              if (ts.isIdentifier(value) && repositoryNames.has(value.text)) {
                violations.push(`${path} exports repository ${value.text}`);
              }
              ts.forEachChild(value, inspectExport);
            };
            inspectExport(node.initializer);
          }
          ts.forEachChild(node, inspect);
        };
        inspect(source);
      }
    }
    expect(violations).toEqual([]);
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

  it("groups feature code beside core and shared infrastructure", () => {
    const expectedRootEntries = [
      "app.module.ts",
      "architecture.spec.ts",
      "auth",
      "characters",
      "character-social",
      "consents",
      "credits",
      "core",
      "events",
      "faqs",
      "feed",
      "follows",
      "health",
      "inquiries",
      "main.ts",
      "messages",
      "notices",
      "notifications",
      "payments",
      "posts",
      "purchases",
      "reports",
      "search",
      "shared",
      "stories",
      "users",
    ];

    const entries = readdirSync("src").filter(
      (entry) => !entry.endsWith(".js"),
    );

    expect(entries.sort()).toEqual(expectedRootEntries.sort());
  });

  it("keeps HTTP controllers out of core and shared infrastructure", () => {
    const infrastructureControllers = [
      ...listFiles("src/core"),
      ...listFiles("src/shared"),
    ].filter((path) => path.endsWith(".controller.ts"));

    expect(infrastructureControllers).toEqual([]);
  });

  it("keeps service routes independent from admin modules", () => {
    const serviceSources = listFiles("src").filter((path) =>
      path.endsWith(".controller.ts"),
    );

    expect(serviceSources.length).toBeGreaterThan(0);
    for (const path of serviceSources) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/from\s+["'].*admin/);
    }
  });

  it("keeps persistence behind approved database adapters", () => {
    const removedFiles = [
      "database/migrations/001_mvp_schema.sql",
      "src/generation/generation.service.ts",
      "src/shared/media/media.service.ts",
      "src/users/users.controller.ts",
    ];

    expect(removedFiles.filter((path) => existsSync(path))).toEqual([]);

    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of [
      "@types/express",
      "postgres",
      "source-map-support",
      "testcontainers",
      "ts-loader",
      "@prisma/adapter-pg",
      "@prisma/client",
      "prisma",
    ]) {
      expect(deps[name]).toBeUndefined();
    }

    for (const path of [
      "src/auth/auth.service.ts",
      "src/characters/characters.service.ts",
      "src/credits/credits.service.ts",
      "src/events/events.service.ts",
      "src/feed/feed.service.ts",
      "src/follows/follows.service.ts",
      "src/messages/messages.service.ts",
      "src/notifications/notifications.service.ts",
      "src/posts/posts.service.ts",
      "src/reports/reports.service.ts",
      "src/users/users.service.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("DB-free fallback");
      expect(source).not.toContain("Prisma");
      expect(source).not.toMatch(/private readonly \w+: .*?\[\] = \[\]/);
    }
  });

  it("uses UUIDv7 defaults for UUID primary keys", () => {
    const schema = readFileSync("src/core/database/schema.ts", "utf8");
    const uuidV7PrimaryKeys = schema.match(
      /uuid\(\)\s*\.primaryKey\(\)\s*\.\$defaultFn\(\(\) => createUuidV7\(\)\)/g,
    );
    expect(uuidV7PrimaryKeys?.length).toBeGreaterThan(0);
  });
});
