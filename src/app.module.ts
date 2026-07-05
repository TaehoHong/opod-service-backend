import { Module } from "@nestjs/common";
import { ServiceModule } from "./service/service.module";

@Module({
  imports: [ServiceModule],
})
export class AppModule {}
