import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { DatabaseTransactionContext } from "./database-transaction-context";

@Module({
  providers: [DatabaseService, DatabaseTransactionContext],
  exports: [DatabaseService, DatabaseTransactionContext],
})
export class DatabaseModule {}
