import { Controller, Get, Module, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { setupServiceSwagger } from "../src/service/swagger";
import { PostsController } from "../src/service/posts/posts.controller";
import { PostsService } from "../src/domain/posts/posts.service";
import { FeedController } from "../src/service/feed/feed.controller";
import { FeedService } from "../src/domain/feed/feed.service";
import { AuthService } from "../src/domain/auth/auth.service";
import { AuthController as RealAuthController } from "../src/service/auth/auth.controller";
import { StoriesController } from "../src/service/stories/stories.controller";
import { StoriesService } from "../src/domain/stories/stories.service";
import { CharactersController } from "../src/service/characters/characters.controller";
import { CharactersService } from "../src/domain/characters/characters.service";
import { FollowsService } from "../src/domain/follows/follows.service";
import {
  HashtagsController,
  SearchController,
} from "../src/service/search/search.controller";
import { ReportsController } from "../src/service/reports/reports.controller";
import { ReportsService } from "../src/domain/reports/reports.service";
import { CreditsController } from "../src/service/credits/credits.controller";
import { CreditsService } from "../src/domain/credits/credits.service";
import { NotificationsController } from "../src/service/notifications/notifications.controller";
import { NotificationsService } from "../src/domain/notifications/notifications.service";
import { FaqsController } from "../src/service/faqs/faqs.controller";
import { FaqsService } from "../src/domain/faqs/faqs.service";
import { NoticesController } from "../src/service/notices/notices.controller";
import { NoticesService } from "../src/domain/notices/notices.service";
import { InquiriesController } from "../src/service/inquiries/inquiries.controller";
import { InquiriesService } from "../src/domain/inquiries/inquiries.service";
import { MessagesController } from "../src/service/messages/messages.controller";
import { MessagesService } from "../src/domain/messages/messages.service";

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

@Module({
  controllers: [RealAuthController],
  providers: [{ provide: AuthService, useValue: {} }],
})
class AuthRealDocModule {}

@Module({
  controllers: [PostsController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: PostsService, useValue: {} },
  ],
})
class PostsDocModule {}

@Module({
  controllers: [FeedController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: FeedService, useValue: {} },
  ],
})
class FeedDocModule {}

@Module({
  controllers: [StoriesController],
  providers: [{ provide: StoriesService, useValue: {} }],
})
class StoriesDocModule {}

@Module({
  controllers: [CharactersController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: CharactersService, useValue: {} },
    { provide: FollowsService, useValue: {} },
    { provide: PostsService, useValue: {} },
    { provide: StoriesService, useValue: {} },
  ],
})
class CharactersDocModule {}

@Module({
  controllers: [HashtagsController, SearchController],
  providers: [
    { provide: CharactersService, useValue: {} },
    { provide: PostsService, useValue: {} },
  ],
})
class SearchDocModule {}

@Module({
  controllers: [ReportsController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: ReportsService, useValue: {} },
  ],
})
class ReportsDocModule {}

@Module({
  controllers: [CreditsController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: CreditsService, useValue: {} },
  ],
})
class CreditsDocModule {}

@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: NotificationsService, useValue: {} },
  ],
})
class NotificationsDocModule {}

@Module({
  controllers: [FaqsController],
  providers: [{ provide: FaqsService, useValue: {} }],
})
class FaqsDocModule {}

@Module({
  controllers: [NoticesController],
  providers: [{ provide: NoticesService, useValue: {} }],
})
class NoticesDocModule {}

@Module({
  controllers: [InquiriesController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: InquiriesService, useValue: {} },
  ],
})
class InquiriesDocModule {}

@Module({
  controllers: [MessagesController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: MessagesService, useValue: {} },
  ],
})
class MessagesDocModule {}

@Controller("admin")
class AdminDocController {
  @Get("characters")
  listCharacters() {
    return [];
  }
}

@Module({ controllers: [AdminDocController] })
class AdminDocModule {}

@Module({
  imports: [
    AdminDocModule,
    CharactersDocModule,
    FeedDocModule,
    PostsDocModule,
    ServiceDocModule,
    StoriesDocModule,
  ],
})
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

  it("documents request, response, and auth examples", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthRealDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [AuthRealDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const registerOperation = response.body.paths["/auth/register"].post;
    const meOperation = response.body.paths["/auth/me"].get;

    expect(
      registerOperation.requestBody.content["application/json"].example,
    ).toMatchObject({
      email: "taeho@example.com",
      password: "password1234",
      displayName: "홍태호",
    });
    expect(
      registerOperation.responses["201"].content["application/json"].example,
    ).toMatchObject({
      accessToken: "eyJhbGciOi...",
      refreshToken: "refresh_abc123",
    });
    expect(
      meOperation.parameters.find(
        (parameter: { name: string }) => parameter.name === "Authorization",
      ),
    ).toMatchObject({
      in: "header",
      required: true,
      schema: { type: "string", example: "Bearer eyJhbGciOi..." },
    });
    expect(
      meOperation.responses["200"].content["application/json"].example,
    ).toMatchObject({
      id: "user_01",
      email: "taeho@example.com",
    });

    await app.close();
  });

  it("documents post content type", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [PostsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);

    expect(
      response.body.components.schemas.PostDto.properties.contentType,
    ).toEqual({
      enum: ["feed", "reel"],
      type: "string",
    });

    await app.close();
  });

  it("documents posts content type filter", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [PostsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const contentTypeParameter = response.body.paths[
      "/posts"
    ].get.parameters.find(
      (parameter: { name: string }) => parameter.name === "contentType",
    );

    expect(contentTypeParameter).toMatchObject({
      in: "query",
      name: "contentType",
      required: false,
      schema: { enum: ["feed", "reel"], type: "string" },
    });

    await app.close();
  });

  it("documents posts query filters as optional", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [PostsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const parameters = response.body.paths["/posts"].get.parameters;

    for (const name of [
      "cursor",
      "limit",
      "characterId",
      "hashtag",
      "mediaType",
      "contentType",
    ]) {
      expect(
        parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    expect(
      parameters.find(
        (parameter: { name: string }) => parameter.name === "mediaType",
      ),
    ).toMatchObject({
      schema: { enum: ["image", "video"], type: "string" },
    });

    await app.close();
  });

  it("documents user post comment creation", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [PostsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);

    expect(
      response.body.paths["/posts/{id}/comments"].get.responses["200"].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/PostCommentPageDto" });
    expect(
      response.body.paths["/posts/{id}/comments"].post.responses["201"].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/PostCommentDto" });
    expect(
      response.body.paths["/posts/{id}/comments"].post.requestBody.content[
        "application/json"
      ].example,
    ).toEqual({ body: "좋아요" });
    expect(
      response.body.paths["/posts/{id}/comments"].post.responses["201"].content[
        "application/json"
      ].example,
    ).toMatchObject({
      id: "comment_01",
      postId: "post_01",
      body: "좋아요",
    });
    for (const name of ["cursor", "limit"]) {
      expect(
        response.body.paths["/posts/{id}/comments"].get.parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    await app.close();
  });

  it("documents user post reactions", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [PostsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const path = response.body.paths["/posts/{id}/reactions"];

    expect(
      path.get.responses["200"].content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/PostReactionsDto" });
    expect(
      path.post.responses["201"].content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/PostReactionDto" });
    expect(
      path.delete.responses["200"].content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/PostReactionDeleteDto" });

    await app.close();
  });

  it("documents auth profile fields", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthRealDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [AuthRealDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const schema = response.body.components.schemas.AuthUserDto.properties;

    expect(schema.bio).toEqual({ type: "string" });
    expect(schema.profileImageUrl).toEqual({ type: "string" });

    await app.close();
  });

  it("documents optional search query filters", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SearchDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [SearchDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const parameters = response.body.paths["/search"].get.parameters;

    expect(
      parameters.find(
        (parameter: { name: string }) => parameter.name === "targetType",
      ),
    ).toMatchObject({
      required: false,
      schema: { enum: ["character", "post", "hashtag"], type: "string" },
    });
    expect(
      parameters.find(
        (parameter: { name: string }) => parameter.name === "limit",
      ),
    ).toMatchObject({ required: false });
    for (const name of ["cursor", "limit"]) {
      expect(
        response.body.paths["/hashtags/{tag}/posts"].get.parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    await app.close();
  });

  it("documents report details as optional", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ReportsDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [ReportsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const schema =
      response.body.paths["/reports"].post.requestBody.content[
        "application/json"
      ].schema;
    const reportSchema =
      response.body.components.schemas[schema.$ref.split("/").at(-1)];

    expect(reportSchema.required).toEqual(["targetType", "targetId", "reason"]);
    expect(reportSchema.properties.details).toEqual({ type: "string" });

    await app.close();
  });

  it("documents credit check-in response", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CreditsDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [CreditsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const schema =
      response.body.paths["/credits/check-in"].post.responses["201"].content[
        "application/json"
      ].schema;

    expect(schema).toEqual({ $ref: "#/components/schemas/CreditCheckInDto" });

    await app.close();
  });

  it("documents credit ledger optional fields", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CreditsDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [CreditsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const schema =
      response.body.paths["/credits/ledger"].get.responses["200"].content[
        "application/json"
      ].schema;
    const pageSchema =
      response.body.components.schemas[schema.$ref.split("/").at(-1)];
    const entryRef = pageSchema.properties.items.items.$ref.split("/").at(-1);
    const entrySchema = response.body.components.schemas[entryRef];

    expect(entrySchema.required).not.toContain("remainingAmount");
    expect(entrySchema.required).not.toContain("expiresAt");
    expect(entrySchema.required).not.toContain("externalReference");
    expect(entrySchema.properties.remainingAmount).toEqual({ type: "number" });
    expect(entrySchema.properties.expiresAt).toEqual({ type: "string" });
    expect(entrySchema.properties.externalReference).toEqual({
      type: "string",
    });
    for (const path of ["/credits/ledger", "/credits/purchases"]) {
      for (const name of ["cursor", "limit"]) {
        expect(
          response.body.paths[path].get.parameters.find(
            (parameter: { name: string }) => parameter.name === name,
          ),
        ).toMatchObject({ required: false });
      }
    }

    await app.close();
  });

  it("documents notification query filters as optional", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationsDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [NotificationsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const parameters = response.body.paths["/notifications"].get.parameters;

    for (const name of ["cursor", "limit", "unreadOnly"]) {
      expect(
        parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    await app.close();
  });

  it("documents faq category as optional", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FaqsDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [FaqsDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const parameters = response.body.paths["/faqs"].get.parameters;

    expect(
      parameters.find(
        (parameter: { name: string }) => parameter.name === "category",
      ),
    ).toMatchObject({ required: false });

    await app.close();
  });

  it("documents notices pagination as optional", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NoticesDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [NoticesDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const parameters = response.body.paths["/notices"].get.parameters;

    for (const name of ["cursor", "limit"]) {
      expect(
        parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    await app.close();
  });

  it("documents inquiries pagination as optional", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InquiriesDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [InquiriesDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const parameters = response.body.paths["/inquiries"].get.parameters;

    for (const name of ["cursor", "limit"]) {
      expect(
        parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    await app.close();
  });

  it("documents messages pagination as optional", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MessagesDocModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [MessagesDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);

    for (const path of ["/messages/conversations", "/messages"]) {
      for (const name of ["cursor", "limit"]) {
        expect(
          response.body.paths[path].get.parameters.find(
            (parameter: { name: string }) => parameter.name === name,
          ),
        ).toMatchObject({ required: false });
      }
    }
    expect(
      response.body.paths["/messages"].get.parameters.find(
        (parameter: { name: string }) => parameter.name === "characterId",
      ),
    ).toMatchObject({ required: true });

    await app.close();
  });

  it("documents feed as feed-only posts", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [FeedDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    const operation = response.body.paths["/feed"].get;

    expect(operation.responses["200"].description).toContain(
      "contentType=feed",
    );
    expect(
      operation.responses["200"].content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/PostPageDto" });
    for (const name of ["cursor", "limit"]) {
      expect(
        operation.parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    await app.close();
  });

  it("documents active stories", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [StoriesDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);

    expect(
      response.body.paths["/stories"].get.responses["200"].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/StoryPageDto" });
    for (const name of ["cursor", "limit"]) {
      expect(
        response.body.paths["/stories"].get.parameters.find(
          (parameter: { name: string }) => parameter.name === name,
        ),
      ).toMatchObject({ required: false });
    }

    await app.close();
  });

  it("documents character stories", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    setupServiceSwagger(app, [CharactersDocModule]);
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);

    expect(
      response.body.paths["/characters/{id}/stories"].get.responses["200"]
        .content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/StoryPageDto" });
    for (const path of ["/characters/{id}/posts", "/characters/{id}/stories"]) {
      for (const name of ["cursor", "limit"]) {
        expect(
          response.body.paths[path].get.parameters.find(
            (parameter: { name: string }) => parameter.name === name,
          ),
        ).toMatchObject({ required: false });
      }
    }

    await app.close();
  });
});
