/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  sum,
} from "drizzle-orm";
import type { DatabaseClient } from "../src/domain/database/database.service";
import { DatabaseService } from "../src/domain/database/database.service";
import {
  characters,
  creditCheckIns,
  creditLedger,
  creditProducts,
  creditPurchases,
  creditRefund,
  creditReservations,
  creditUsage,
  faqs,
  hashtags,
  inquiries,
  media,
  messageConversations,
  messageReplyJobs,
  messages,
  notices,
  notifications,
  paymentLedger,
  paymentProductMappings,
  payments,
  postComments,
  postHashtags,
  postReactions,
  posts,
  stories,
  userAccounts,
  userCharacterFollows,
  userEvents,
  userRefreshTokens,
  users,
  userWithdrawals,
} from "../src/domain/database/schema";

type RelationWhere = (
  client: DatabaseClient,
  value: Record<string, unknown>,
) => unknown;

function projection(table: any, select?: Record<string, boolean>) {
  if (!select) return undefined;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, included]) => included)
      .map(([key]) => [key, table[key]]),
  );
}

function whereCondition(
  table: any,
  where: Record<string, any> | undefined,
  client: DatabaseClient,
  relations: Record<string, RelationWhere>,
): any {
  if (!where) return undefined;
  const conditions: any[] = [];
  for (const [key, value] of Object.entries(where)) {
    const column = table[key];
    if (!column) {
      if (relations[key]) {
        conditions.push(relations[key](client, value));
      } else if (value && typeof value === "object") {
        conditions.push(whereCondition(table, value, client, relations));
      }
      continue;
    }
    if (value === null) {
      conditions.push(isNull(column));
    } else if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value) conditions.push(inArray(column, value.in));
      if ("not" in value) {
        conditions.push(
          value.not === null ? isNotNull(column) : ne(column, value.not),
        );
      }
      if ("gt" in value) conditions.push(gt(column, value.gt));
      if ("lt" in value) conditions.push(lt(column, value.lt));
      if ("lte" in value) conditions.push(lte(column, value.lte));
    } else {
      conditions.push(eq(column, value));
    }
  }
  return and(...conditions);
}

class TestModel {
  constructor(
    protected readonly client: DatabaseClient,
    protected readonly table: any,
    protected readonly relations: Record<string, RelationWhere> = {},
    private readonly nestedCreate?: (
      client: DatabaseClient,
      row: Record<string, any>,
      nested: Record<string, any>,
    ) => Promise<void>,
  ) {}

  async create(input: {
    data: Record<string, any>;
    select?: Record<string, boolean>;
  }) {
    const nested = Object.fromEntries(
      Object.entries(input.data).filter(([key]) => !this.table[key]),
    );
    const data = Object.fromEntries(
      Object.entries(input.data).filter(([key]) => this.table[key]),
    );
    return this.client.transaction(async (tx) => {
      const [row] = (await tx
        .insert(this.table)
        .values(data)
        .returning()) as any[];
      if (this.nestedCreate) await this.nestedCreate(tx as any, row, nested);
      if (!input.select) return row;
      return Object.fromEntries(
        Object.keys(input.select)
          .filter((key) => input.select?.[key])
          .map((key) => [key, row[key]]),
      );
    });
  }

  async createMany(input: { data: Array<Record<string, any>> }) {
    if (!input.data.length) return { count: 0 };
    await this.client.insert(this.table).values(input.data);
    return { count: input.data.length };
  }

  async findUnique(input: any) {
    return this.findFirst(input);
  }

  async findUniqueOrThrow(input: any) {
    const row = await this.findFirst(input);
    if (!row) throw new Error("Expected row was not found");
    return row;
  }

  async findFirstOrThrow(input: any) {
    return this.findUniqueOrThrow(input);
  }

  async findFirst(input: any = {}): Promise<any> {
    const fields = projection(this.table, input.select);
    let query: any = fields ? this.client.select(fields) : this.client.select();
    query = query
      .from(this.table)
      .where(
        whereCondition(this.table, input.where, this.client, this.relations),
      ) as any;
    if (input.orderBy) query = this.applyOrder(query, input.orderBy);
    const [row] = await query.limit(1);
    return row ?? null;
  }

  async findMany(input: any = {}): Promise<any[]> {
    const fields = projection(this.table, input.select);
    let query: any = fields ? this.client.select(fields) : this.client.select();
    query = query
      .from(this.table)
      .where(
        whereCondition(this.table, input.where, this.client, this.relations),
      ) as any;
    if (input.orderBy) query = this.applyOrder(query, input.orderBy);
    if (input.take) query = query.limit(input.take);
    return (await query) as any[];
  }

  async update(input: {
    where: Record<string, any>;
    data: Record<string, any>;
  }) {
    const [row] = (await this.client
      .update(this.table)
      .set(input.data)
      .where(
        whereCondition(this.table, input.where, this.client, this.relations),
      )
      .returning()) as any[];
    if (!row) throw new Error("Expected row was not found");
    return row;
  }

  async updateMany(input: {
    where: Record<string, any>;
    data: Record<string, any>;
  }) {
    const rows = (await this.client
      .update(this.table)
      .set(input.data)
      .where(
        whereCondition(this.table, input.where, this.client, this.relations),
      )
      .returning()) as any[];
    return { count: rows.length };
  }

  async deleteMany(input: { where?: Record<string, any> } = {}) {
    const rows = (await this.client
      .delete(this.table)
      .where(
        whereCondition(this.table, input.where, this.client, this.relations),
      )
      .returning()) as any[];
    return { count: rows.length };
  }

  async count(input: { where?: Record<string, any> } = {}) {
    const [row] = await this.client
      .select({ value: count() })
      .from(this.table)
      .where(
        whereCondition(this.table, input.where, this.client, this.relations),
      );
    return row.value;
  }

  async aggregate(input: any) {
    const selection: Record<string, any> = {};
    if (input._count) selection._count = count();
    if (input._sum) {
      selection._sum = Object.fromEntries(
        Object.keys(input._sum).map((key) => [
          key,
          sum(this.table[key]).mapWith(Number),
        ]),
      );
    }
    const [row] = await this.client
      .select(selection)
      .from(this.table)
      .where(
        whereCondition(this.table, input.where, this.client, this.relations),
      );
    return row;
  }

  private applyOrder(query: any, orderBy: any) {
    const values = Array.isArray(orderBy) ? orderBy : [orderBy];
    const orders = values.flatMap((order) =>
      Object.entries(order)
        .filter(([key]) => this.table[key])
        .map(([key, direction]) =>
          direction === "desc" ? desc(this.table[key]) : asc(this.table[key]),
        ),
    );
    return orders.length ? query.orderBy(...orders) : query;
  }
}

class CreditUsageTestModel extends TestModel {
  override async findMany(input: any = {}): Promise<any[]> {
    if (!input.include?.grantLedger) return super.findMany(input);
    const rows = await this.client
      .select({
        usage: getTableColumns(creditUsage),
        grantLedger: getTableColumns(creditLedger),
      })
      .from(creditUsage)
      .innerJoin(creditLedger, eq(creditUsage.grantLedgerId, creditLedger.id))
      .where(
        whereCondition(creditUsage, input.where, this.client, this.relations),
      );
    return rows.map(({ usage, grantLedger }) => ({ ...usage, grantLedger }));
  }
}

export class TestDatabase {
  readonly client: DatabaseClient;
  readonly character: TestModel;
  readonly creditCheckIn: TestModel;
  readonly creditLedger: TestModel;
  readonly creditProduct: TestModel;
  readonly creditPurchase: TestModel;
  readonly creditRefund: TestModel;
  readonly creditReservation: TestModel;
  readonly creditUsage: TestModel;
  readonly faq: TestModel;
  readonly hashtag: TestModel;
  readonly inquiry: TestModel;
  readonly media: TestModel;
  readonly message: TestModel;
  readonly messageConversation: TestModel;
  readonly messageReplyJob: TestModel;
  readonly notice: TestModel;
  readonly notification: TestModel;
  readonly payment: TestModel;
  readonly paymentLedger: TestModel;
  readonly paymentProductMapping: TestModel;
  readonly post: TestModel;
  readonly postComment: TestModel;
  readonly postReaction: TestModel;
  readonly story: TestModel;
  readonly user: TestModel;
  readonly userAccount: TestModel;
  readonly userCharacterFollow: TestModel;
  readonly userEvent: TestModel;
  readonly userRefreshToken: TestModel;
  readonly userWithdrawal: TestModel;

  constructor(database: DatabaseService) {
    this.client = database.client;
    const model = (
      table: any,
      relations: Record<string, RelationWhere> = {},
      nestedCreate?: ConstructorParameters<typeof TestModel>[3],
    ) => new TestModel(this.client, table, relations, nestedCreate);
    const paymentRelation: RelationWhere = (client, value) =>
      inArray(
        paymentLedger.paymentId,
        client
          .select({ id: payments.id })
          .from(payments)
          .where(whereCondition(payments, value, client, {})),
      );

    this.character = model(characters);
    this.creditCheckIn = model(creditCheckIns);
    this.creditLedger = model(creditLedger);
    this.creditProduct = model(creditProducts);
    this.creditPurchase = model(creditPurchases);
    this.creditRefund = model(creditRefund);
    this.creditReservation = model(creditReservations);
    this.creditUsage = new CreditUsageTestModel(this.client, creditUsage);
    this.faq = model(faqs);
    this.hashtag = model(hashtags);
    this.inquiry = model(inquiries);
    this.media = model(media);
    this.message = model(messages, {
      conversation: (client, value) =>
        inArray(
          messages.conversationId,
          client
            .select({ id: messageConversations.id })
            .from(messageConversations)
            .where(whereCondition(messageConversations, value, client, {})),
        ),
    });
    this.messageConversation = model(
      messageConversations,
      {},
      async (client, row, nested) => {
        const values = nested.messages?.create;
        if (!values) return;
        const rows = (Array.isArray(values) ? values : [values]).map(
          (value) => ({
            ...value,
            conversationId: row.id,
          }),
        );
        await client.insert(messages).values(rows);
      },
    );
    this.messageReplyJob = model(messageReplyJobs);
    this.notice = model(notices);
    this.notification = model(notifications);
    this.payment = model(payments);
    this.paymentLedger = model(paymentLedger, { payment: paymentRelation });
    this.paymentProductMapping = model(paymentProductMappings);
    this.post = model(posts, {}, async (client, row, nested) => {
      const value = nested.hashtags?.create;
      if (value)
        await client.insert(postHashtags).values({ postId: row.id, ...value });
    });
    this.postComment = model(postComments);
    this.postReaction = model(postReactions);
    this.story = model(stories);
    this.user = model(users);
    this.userAccount = model(userAccounts);
    this.userCharacterFollow = model(userCharacterFollows);
    this.userEvent = model(userEvents);
    this.userRefreshToken = model(userRefreshTokens);
    this.userWithdrawal = model(userWithdrawals);
  }
}
