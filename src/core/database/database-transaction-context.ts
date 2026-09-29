import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseClient } from "./database.service";

export type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

type TransactionScope = {
  transaction: DatabaseTransaction;
  characterId: string;
  active: boolean;
};

@Injectable()
export class DatabaseTransactionContext {
  private readonly storage = new AsyncLocalStorage<TransactionScope>();

  async run<T>(
    transaction: DatabaseTransaction,
    characterId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const scope = { transaction, characterId, active: true };
    try {
      return await this.storage.run(scope, work);
    } finally {
      scope.active = false;
    }
  }

  current(): { transaction: DatabaseTransaction; characterId: string } | null {
    const scope = this.storage.getStore();
    if (scope && !scope.active) {
      throw new Error("database transaction scope has already closed");
    }
    return scope ?? null;
  }

  require(): DatabaseTransaction {
    const scope = this.current();
    if (!scope) {
      throw new Error("an active database transaction is required");
    }
    return scope.transaction;
  }
}
