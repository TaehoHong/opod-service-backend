import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("auth", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers, authenticates, refreshes, and revokes a human session", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email,
        password: "password123",
        displayName: "Reader",
      })
      .expect(201);

    expect(registered.body.user).toMatchObject({
      displayName: "Reader",
      email,
    });
    expect(registered.body.accessToken).toEqual(expect.any(String));
    expect(registered.body.refreshToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .expect(200)
      .expect(registered.body.user);

    const updatedUser = {
      ...registered.body.user,
      displayName: "Updated Reader",
    };

    await request(app.getHttpServer())
      .patch("/auth/me")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .send({ displayName: " Updated Reader " })
      .expect(200)
      .expect(updatedUser);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .expect(200)
      .expect(updatedUser);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email,
        password: "password123",
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.user).toEqual(updatedUser);
        expect(response.body.accessToken).toEqual(expect.any(String));
        expect(response.body.refreshToken).toEqual(expect.any(String));
      });

    const refreshed = await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: registered.body.refreshToken })
      .expect(201);

    expect(refreshed.body.refreshToken).not.toBe(registered.body.refreshToken);

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: registered.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .delete("/auth/session")
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(200)
      .expect({ revoked: true });

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it("rejects invalid credentials and missing bearer tokens", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email,
        password: "password123",
        displayName: "Reader",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email,
        password: "wrong-password",
      })
      .expect(401);

    await request(app.getHttpServer()).get("/auth/me").expect(401);
    await request(app.getHttpServer()).patch("/auth/me").expect(401);
    await request(app.getHttpServer()).get("/feed").expect(401);
  });
});
