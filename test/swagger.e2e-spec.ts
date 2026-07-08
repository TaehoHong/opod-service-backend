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
    expect(response.body.tags.map((tag: { name: string }) => tag.name)).toEqual(
      [
        "인증",
        "캐릭터",
        "피드",
        "게시글",
        "팔로우",
        "메시지",
        "크레딧",
        "알림",
        "신고",
        "고객지원",
        "검색",
        "이벤트",
        "시스템",
      ],
    );
    expect(response.body.paths["/auth/register"].post.tags).toEqual(["인증"]);
    expect(response.body.paths["/health"].get.tags).toEqual(["시스템"]);

    await app.close();
  });
});
