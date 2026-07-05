import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import request from "supertest";

export async function registerHuman(app: INestApplication) {
  const response = await request(app.getHttpServer())
    .post("/auth/register")
    .send({
      email: `reader-${randomUUID()}@example.com`,
      password: "password123",
      displayName: "Reader",
    })
    .expect(201);

  return {
    user: response.body.user as {
      id: string;
      displayName: string;
      email: string;
    },
    accessToken: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    authHeaders: {
      Authorization: `Bearer ${response.body.accessToken as string}`,
    },
  };
}
