import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PurchasesModule } from "./purchases.module";
import { PurchasesController } from "./purchases.controller";

@Module({
  imports: [AuthModule, PurchasesModule],
  controllers: [PurchasesController],
})
export class ServicePurchasesModule {}
