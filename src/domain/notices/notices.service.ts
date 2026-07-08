import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { decodeCursor, pageFromRows, PageInput } from "../database/page";
import { isUuid } from "../database/uuid";

export type NoticeListItem = {
  id: string;
  title: string;
  isPinned: boolean;
  publishedAt: Date;
};

export type NoticeDetail = NoticeListItem & { body: string };

const noticeListFields = {
  id: true,
  title: true,
  isPinned: true,
  publishedAt: true,
} as const;

// 고정 공지는 운영에서 소수만 유지한다 — 안전 상한.
const maxPinnedNotices = 20;

@Injectable()
export class NoticesService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublishedNotices(input: PageInput): Promise<{
    pinned?: NoticeListItem[];
    items: NoticeListItem[];
    nextCursor?: string;
  }> {
    const cursorId = decodeCursor(input.cursor);
    const publishedWhere = { publishedAt: { not: null, lte: new Date() } };

    // 고정 우선 정렬은 커서 페이지네이션과 섞이면 페이지 경계가 깨진다 —
    // 고정 공지는 첫 페이지에서만 별도 배열로 반환한다 (정책 §4).
    const pinned = cursorId
      ? undefined
      : ((await this.prisma.notice.findMany({
          where: { ...publishedWhere, isPinned: true },
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          take: maxPinnedNotices,
          select: noticeListFields,
        })) as NoticeListItem[]);

    const rows = (await this.prisma.notice.findMany({
      where: { ...publishedWhere, isPinned: false },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: noticeListFields,
    })) as NoticeListItem[];

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
    return (await this.prisma.notice.findFirst({
      where: {
        id: noticeId,
        publishedAt: { not: null, lte: new Date() },
      },
      select: { ...noticeListFields, body: true },
    })) as NoticeDetail | null;
  }
}
