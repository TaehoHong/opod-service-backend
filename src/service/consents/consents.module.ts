import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { ConsentsModule } from "../../domain/consents/consents.module";
import { ConsentsController } from "./consents.controller";
import { TermsController } from "./terms.controller";

@Module({
  imports: [AuthModule, ConsentsModule],
  controllers: [TermsController, ConsentsController],
})
export class ServiceConsentsModule {}
