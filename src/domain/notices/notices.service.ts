import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { decodeCursor, pageFromRows, PageInput } from "../database/page";
import { notices } from "../database/schema";
import { isUuid } from "../database/uuid";

export type NoticeListItem = {
  id: string;
  title: string;
  isPinned: boolean;
  publishedAt: Date;
};

export type NoticeDetail = NoticeListItem & { body: string };

const noticeListFields = {
  id: notices.id,
  title: notices.title,
  isPinned: notices.isPinned,
  publishedAt: notices.publishedAt,
};

// 고정 공지는 운영에서 소수만 유지한다 — 안전 상한.
const maxPinnedNotices = 20;

@Injectable()
export class NoticesService {
  constructor(private readonly database: DatabaseService) {}

  async listPublishedNotices(input: PageInput): Promise<{
    pinned?: NoticeListItem[];
    items: NoticeListItem[];
    nextCursor?: string;
  }> {
    const cursorId = decodeCursor(input.cursor);
    const now = new Date();
    const publishedWhere = and(
      isNotNull(notices.publishedAt),
      lte(notices.publishedAt, now),
    );

    const [cursor] = cursorId
      ? await this.database.client
          .select({ publishedAt: notices.publishedAt })
          .from(notices)
          .where(eq(notices.id, cursorId))
          .limit(1)
      : [];
    const cursorWhere = cursorId
      ? cursor?.publishedAt
        ? or(
            lt(notices.publishedAt, cursor.publishedAt),
            and(
              eq(notices.publishedAt, cursor.publishedAt),
              lt(notices.id, cursorId),
            ),
          )
        : sql`false`
      : undefined;

    // 고정 우선 정렬은 커서 페이지네이션과 섞이면 페이지 경계가 깨진다 —
    // 고정 공지는 첫 페이지에서만 별도 배열로 반환한다 (정책 §4).
    const pinned = cursorId
      ? undefined
      : await this.database.client
          .select(noticeListFields)
          .from(notices)
          .where(and(publishedWhere, eq(notices.isPinned, true)))
          .orderBy(desc(notices.publishedAt), desc(notices.id))
          .limit(maxPinnedNotices)
          .then((rows) =>
            rows.map((row) => ({ ...row, publishedAt: row.publishedAt! })),
          );

    const rows = await this.database.client
      .select(noticeListFields)
      .from(notices)
      .where(and(publishedWhere, eq(notices.isPinned, false), cursorWhere))
      .orderBy(desc(notices.publishedAt), desc(notices.id))
      .limit(input.limit + 1)
      .then((result) =>
        result.map((row) => ({ ...row, publishedAt: row.publishedAt! })),
      );

    return {
      ...(pinned ? { pinned } : {}),
      ...pageFromRows(rows, input.limit),
    };
  }

  async findPublishedNotice(noticeId: string): Promise<NoticeDetail | null> {
    // uuid 형식이 아닌 id는 존재하지 않는 공지로 취급한다.
    if (!isUuid(noticeId)) {
      return null;
    }
    const [notice] = await this.database.client
      .select({ ...noticeListFields, body: notices.body })
      .from(notices)
      .where(
        and(
          eq(notices.id, noticeId),
          isNotNull(notices.publishedAt),
          lte(notices.publishedAt, new Date()),
        ),
      )
      .limit(1);
    return notice ? { ...notice, publishedAt: notice.publishedAt! } : null;
  }
}
