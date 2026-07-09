import { INestApplication, Type } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function setupServiceSwagger(
  app: INestApplication,
  serviceModules: Array<Type<unknown>>,
) {
  const config = new DocumentBuilder()
    .setTitle("AI SNS Service API")
    .setVersion("0.1.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "로그인/회원가입 응답의 accessToken을 입력합니다.",
    })
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    include: serviceModules,
  });

  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: {
      docExpansion: "none",
      operationsSorter: "alpha",
      persistAuthorization: true,
    },
  });
}
