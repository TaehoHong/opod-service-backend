import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { PrismaModule } from "../database/prisma.module";
import { PaymentsModule } from "../payments/payments.module";
import { PurchasesService } from "./purchases.service";

@Module({
  imports: [PrismaModule, CreditsModule, PaymentsModule],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
