import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { DatabaseModule } from "../database/database.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";
import { PurchasesService } from "./purchases.service";

@Module({
  imports: [DatabaseModule, CreditsModule, PaymentsModule, NotificationsModule],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
