import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { PurchasesModule } from "../../domain/purchases/purchases.module";
import { PurchasesController } from "./purchases.controller";

@Module({
  imports: [AuthModule, PurchasesModule],
  controllers: [PurchasesController],
})
export class ServicePurchasesModule {}
