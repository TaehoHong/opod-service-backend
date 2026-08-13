import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ServiceModule } from "./service/service.module";
import { setupServiceSwagger } from "./service/swagger";

async function bootstrap() {
  // Request validation runs through the APP_PIPE provider in ServiceModule so
  // module-built test apps exercise the same pipe.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
  }
  if (trustedProxyHops > 0) {
    app.getHttpAdapter().getInstance().set("trust proxy", trustedProxyHops);
  }
  const configuredWebUrl = process.env.WEB_APP_URL?.trim();
  let configuredWebOrigin: string | undefined;
  if (configuredWebUrl) {
    try {
      const url = new URL(configuredWebUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        configuredWebOrigin = url.origin;
      }
    } catch {
      // Checkout creation reports a configuration error with a safe 409.
    }
  }
  app.enableCors({
    origin: [
      "https://opod-web.vercel.app",
      ...(configuredWebOrigin ? [configuredWebOrigin] : []),
      /^https?:\/\/localhost(?::\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
    ],
  });
  setupServiceSwagger(app, [ServiceModule]);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
