import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentsModule } from "./consents.module";
import { ConsentsController } from "./consents.controller";
import { TermsController } from "./terms.controller";

@Module({
  imports: [AuthModule, ConsentsModule],
  controllers: [TermsController, ConsentsController],
})
export class ServiceConsentsModule {}
