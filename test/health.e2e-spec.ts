import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("health", () => {
  it("returns service status", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    await request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({ status: "ok", service: "ai-sns-backend" });

    await app.close();
  });
});
