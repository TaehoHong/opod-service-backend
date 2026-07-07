import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ServiceModule } from "./service/service.module";
import { setupServiceSwagger } from "./service/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [
      "https://opod-web.vercel.app",
      /^https?:\/\/localhost(?::\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
    ],
  });
  setupServiceSwagger(app, [ServiceModule]);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
