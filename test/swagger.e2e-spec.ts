import { Controller, Get, Module, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { setupServiceSwagger } from "../src/service/swagger";

@Controller("health")
class ServiceDocController {
  @Get()
  getHealth() {
    return { status: "ok" };
  }
}

@Controller("auth")
class AuthDocController {
  @Post("register")
  register() {
    return {};
  }
}

@Module({ controllers: [AuthDocController, ServiceDocController] })
class ServiceDocModule {}

@Controller("admin")
class AdminDocController {
  @Get("characters")
  listCharacters() {
    return [];
  }
}

@Module({ controllers: [AdminDocController] })
class AdminDocModule {}

@Module({ imports: [AdminDocModule, ServiceDocModule] })
class TestAppModule {}

describe("service swagger", () => {
  it("documents service routes without admin routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [ServiceDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const paths = Object.keys(response.body.paths);

    expect(paths).toContain("/health");
    expect(paths).toContain("/auth/register");
    expect(paths.some((path) => path.startsWith("/admin"))).toBe(false);

    await app.close();
  });
});
