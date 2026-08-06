// 알림 타입 정본. 새 알림을 배선할 때 이 목록에 추가한다.
//
// 여기 없는 타입이 DB에 들어올 수 있다: 게시글·스토리 등록, 문의 답변, 공지,
// 신고 처리는 트리거가 opod-admin에 있어 admin이 같은 `notifications` 테이블에
// 직접 insert한다. 두 리포가 코드를 공유하지 않으므로 문자열 계약만 맞춘다.
export const NOTIFICATION_TYPES = {
  creditPurchaseCompleted: "credit.purchase_completed",
  creditRefundCompleted: "credit.refund_completed",
  characterNewPost: "character.new_post",
  characterNewStory: "character.new_story",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

// targetId가 가리키는 대상. 클라이언트가 상세를 다시 조회하는 데 쓴다.
export type NotificationTargetType = "purchase" | "refund" | "post" | "story";

// 한 번의 sync가 만들 수 있는 팔로우 알림 수 상한. 오래 앱을 열지 않은 유저가
// 알림함을 수백 건으로 채우는 것을 막는다. 상한을 넘긴 분량은 조용히 버리지
// 않고 응답의 `skipped`로 보고한다.
export const FOLLOW_NOTIFICATION_SYNC_LIMIT = 50;
