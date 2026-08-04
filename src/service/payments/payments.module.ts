import { Module } from "@nestjs/common";
import { PurchasesModule } from "../../domain/purchases/purchases.module";
import { PaymentsController } from "./payments.controller";

@Module({
  imports: [PurchasesModule],
  controllers: [PaymentsController],
})
export class ServicePaymentsModule {}
