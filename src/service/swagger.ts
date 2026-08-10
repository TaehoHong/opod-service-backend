import { INestApplication, Type } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation | unknown>>;
  tags?: OpenApiTag[];
};

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
  tags?: string[];
};

type OpenApiTag = {
  name: string;
  description: string;
};

type OperationExample = {
  auth?: boolean | "optional";
  // 라우트 이름만 봐서는 알 수 없는 동작을 적는다. 응답 예시로 드러나는 사실은
  // 반복하지 않는다.
  summary?: string;
  description?: string;
  request?: unknown;
  response?: unknown;
  status?: string;
  // 호출자가 분기해야 하는 실패만 적는다. 인증 누락처럼 전역으로 같은 것은 뺀다.
  errors?: Record<string, { description: string; example?: unknown }>;
};

export function setupServiceSwagger(
  app: INestApplication,
  serviceModules: Array<Type<unknown>>,
) {
  const config = new DocumentBuilder()
    .setTitle("AI SNS Service API")
    .setVersion("0.1.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "로그인/회원가입 응답의 accessToken을 입력합니다.",
    })
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    include: serviceModules,
  });

  const openApiDocument = document as unknown as OpenApiDocument;
  addDomainTags(openApiDocument);
  addOperationExamples(openApiDocument);

  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: {
      docExpansion: "none",
      operationsSorter: "alpha",
      persistAuthorization: true,
    },
  });
}

const serviceTags: OpenApiTag[] = [
  { name: "인증", description: "회원가입, 로그인, 세션 API" },
  { name: "캐릭터", description: "AI 캐릭터 조회와 관계 API" },
  { name: "피드", description: "사용자 피드 API" },
  { name: "게시글", description: "게시글, 댓글, 반응 API" },
  { name: "팔로우", description: "캐릭터 팔로우 API" },
  { name: "메시지", description: "대화와 메시지 API" },
  { name: "크레딧", description: "크레딧 잔액과 사용 내역 API" },
  { name: "크레딧 구매", description: "크레딧 상품, 구매와 환불 API" },
  { name: "결제", description: "결제 provider 알림 수신 API" },
  { name: "알림", description: "사용자 알림 API" },
  { name: "신고", description: "콘텐츠 신고 API" },
  { name: "고객지원", description: "FAQ, 공지사항, 1:1 문의 API" },
  { name: "약관", description: "약관·개인정보 문서와 동의 기록 API" },
  { name: "검색", description: "통합 검색과 해시태그 API" },
  { name: "이벤트", description: "클라이언트 이벤트 수집 API" },
  { name: "시스템", description: "서비스 상태 확인 API" },
];

const tagByPathSegment: Record<string, string> = {
  auth: "인증",
  characters: "캐릭터",
  feed: "피드",
  posts: "게시글",
  follows: "팔로우",
  messages: "메시지",
  credits: "크레딧",
  payments: "결제",
  purchases: "크레딧 구매",
  notifications: "알림",
  reports: "신고",
  faqs: "고객지원",
  notices: "고객지원",
  inquiries: "고객지원",
  terms: "약관",
  consents: "약관",
  search: "검색",
  hashtags: "검색",
  events: "이벤트",
  stories: "피드",
  health: "시스템",
};

const isoDate = "2026-07-05T08:00:00.000Z";
const storyExpiresAt = "2026-07-06T08:00:00.000Z";
const user = {
  id: "user_01",
  displayName: "홍태호",
  bio: "AI 캐릭터와 대화하는 사용자",
  profileImageUrl: "https://cdn.example.com/users/user_01.jpg",
  email: "taeho@example.com",
};
const authTokens = {
  user,
  accessToken: "eyJhbGciOi...",
  refreshToken: "refresh_abc123",
};
const character = {
  id: "character_01",
  publicId: "mira",
  displayName: "Mira",
  bio: "일상과 여행을 공유하는 AI 캐릭터",
  interests: ["travel", "fashion"],
  profileImage: {
    url: "https://cdn.example.com/characters/mira.jpg",
    width: 1024,
    height: 1024,
    crop: { x: 0.5, y: 0.4, zoom: 1.2 },
  },
};
const media = {
  mediaType: "image",
  url: "https://cdn.example.com/posts/01.jpg",
  width: 1080,
  height: 1350,
};
const post = {
  id: "post_01",
  characterId: "character_01",
  contentType: "feed",
  content: "오늘의 기록",
  media: [media],
  hashtags: ["travel"],
  createdAt: isoDate,
};
const story = {
  id: "story_01",
  characterId: "character_01",
  caption: "하루 동안만 공개되는 여행 기록",
  media,
  createdAt: isoDate,
  expiresAt: storyExpiresAt,
};
const postComment = {
  id: "comment_01",
  postId: "post_01",
  userId: "user_01",
  body: "좋아요",
  createdAt: isoDate,
};
const postReaction = {
  id: "reaction_01",
  postId: "post_01",
  userId: "user_01",
  reactionType: "like",
  createdAt: isoDate,
};
// 사용자 메시지와 그 답변은 같은 turnId를 공유한다. 답변이 비동기로 오므로
// 목록에서는 두 메시지 사이에 다른 턴이 끼어 있을 수 있다.
const message = {
  id: "message_01",
  conversationId: "conversation_01",
  senderType: "user",
  body: "안녕",
  createdAt: isoDate,
  turnId: "message_01",
  replyStatus: "pending",
};
const characterMessage = {
  id: "message_02",
  conversationId: "conversation_01",
  senderType: "character",
  body: "안녕! 오늘 필름 한 통 다 썼어.",
  createdAt: "2026-07-05T08:00:12.000Z",
  turnId: "message_01",
  replyStatus: "completed",
};
const insufficientCredits = {
  statusCode: 402,
  message: "Insufficient credits",
  error: "INSUFFICIENT_CREDITS",
};
const creditEntry = {
  id: "credit_entry_01",
  userId: "user_01",
  type: "usage",
  amount: 10,
  expiresAt: "2026-08-05T08:00:00.000Z",
  reason: "message",
  externalReference: "message_01",
  createdAt: isoDate,
};
const creditPurchase = {
  id: "purchase_01",
  productId: "credits_1050",
  status: "pending",
  creditAmount: 1050,
  createdAt: isoDate,
  payment: {
    channel: "web",
    provider: "local",
    status: "pending",
    amount: 9900,
    currency: "KRW",
  },
};
const creditRefund = {
  id: "refund_01",
  purchaseId: "purchase_01",
  status: "payment_processing",
  creditAmount: 60,
  promotionAmount: 10,
  grossAmount: 5940,
  feeAmount: 297,
  refundAmount: 5643,
  currency: "KRW",
  reason: "user_request",
  createdAt: isoDate,
};
const notification = {
  id: "notification_01",
  type: "message",
  title: "새 메시지",
  body: "Mira가 답장했습니다.",
  targetType: "message",
  targetId: "message_01",
  readAt: null,
  createdAt: isoDate,
};
const report = {
  id: "report_01",
  targetType: "post",
  targetId: "post_01",
  reason: "spam",
  details: "광고성 게시물",
  resolution: null,
  status: "submitted",
  createdAt: isoDate,
  updatedAt: isoDate,
};

const page = (item: unknown) => ({
  items: [item],
  nextCursor: "cursor_abc123",
});

const operationExamples: Record<string, OperationExample> = {
  AuthController_register: {
    request: {
      email: "taeho@example.com",
      password: "password1234",
      displayName: "홍태호",
      consents: [
        { type: "terms_of_service", agreed: true },
        { type: "privacy", agreed: true },
        { type: "age_14", agreed: true },
        { type: "marketing", agreed: false },
      ],
    },
    response: authTokens,
    status: "201",
  },
  AuthController_login: {
    request: { email: "taeho@example.com", password: "password1234" },
    response: authTokens,
    status: "201",
  },
  AuthController_socialLogin: {
    request: {
      idToken: "eyJhbGciOiJSUzI1NiIs...",
      displayName: "홍태호",
      consents: [
        { type: "terms_of_service", agreed: true },
        { type: "privacy", agreed: true },
        { type: "age_14", agreed: true },
      ],
    },
    response: authTokens,
    status: "201",
  },
  AuthController_refresh: {
    request: { refreshToken: "refresh_abc123" },
    response: authTokens,
    status: "201",
  },
  AuthController_me: { auth: true, response: user },
  AuthController_updateMe: {
    auth: true,
    request: {
      displayName: "새 이름",
      bio: "업데이트된 자기소개",
      profileImageUrl: "https://cdn.example.com/users/user_01-new.jpg",
    },
    response: user,
  },
  AuthController_deleteMe: {
    auth: true,
    request: {
      password: "password1234",
      reasonCategory: "low_usage",
      reasonText: "자주 사용하지 않아요",
    },
    response: { deleted: true },
  },
  AuthController_changePassword: {
    auth: true,
    request: {
      currentPassword: "password1234",
      newPassword: "new-password5678",
    },
    response: authTokens,
  },
  AuthController_verifyAdultIdentity: {
    auth: true,
    request: { providerIdentityKey: "local-provider-ci" },
    response: { adultVerified: true, debtApplied: 120, paidDebt: 120 },
    status: "201",
  },
  AuthController_revokeSession: {
    request: { refreshToken: "refresh_abc123" },
    response: { revoked: true },
  },

  CharactersController_listCharacters: { response: [character] },
  CharactersController_getCharacter: { response: character },
  CharactersController_listCharacterPosts: { response: page(post) },
  CharactersController_listCharacterStories: { response: page(story) },
  CharactersController_getCharacterRelationship: {
    auth: true,
    response: {
      characterId: "character_01",
      isFollowing: true,
      followedAt: isoDate,
      bondLevel: 3,
    },
  },

  PurchasesController_listProducts: {
    response: {
      items: [
        {
          id: "credits_1050",
          creditAmount: 1050,
          providerProductId: "credits_1050",
        },
      ],
    },
  },
  PurchasesController_accountToken: {
    auth: true,
    response: {
      apple: "00000000-0000-5000-8000-000000000000",
      google:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  },
  PurchasesController_createCheckout: {
    auth: true,
    request: { productId: "credits_1050" },
    response: {
      ...creditPurchase,
      checkoutUrl: "https://payments.local/checkout/purchase_01",
    },
    status: "201",
  },
  PurchasesController_verifyApple: {
    auth: true,
    request: { productId: "credits_1050", proof: "signed-transaction" },
    response: { ...creditPurchase, status: "completed" },
    status: "201",
  },
  PurchasesController_verifyGoogle: {
    auth: true,
    request: { productId: "credits_1050", proof: "purchase-token" },
    response: { ...creditPurchase, status: "completed" },
    status: "201",
  },
  CreditsController_spendCredits: {
    auth: true,
    request: { amount: 10, reason: "message", externalReference: "message_01" },
    response: creditEntry,
    status: "201",
  },
  CreditsController_checkIn: {
    auth: true,
    response: {
      checkInDate: "2026-07-05",
      creditsGranted: 10,
      milestoneBonus: 0,
      monthCheckInCount: 5,
    },
    status: "201",
  },
  CreditsController_getBalance: {
    auth: true,
    response: {
      userId: "user_01",
      balance: 90,
      paidBalance: 80,
      freeBalance: 10,
    },
  },
  CreditsController_listEntries: { auth: true, response: page(creditEntry) },
  PurchasesController_list: {
    auth: true,
    response: page(creditPurchase),
  },
  PurchasesController_refundQuote: {
    auth: true,
    response: {
      purchaseId: "purchase_01",
      currency: "KRW",
      originalCredits: 100,
      remainingCredits: 60,
      lockedCredits: 0,
      refundableCredits: 60,
      minimumCredits: 50,
      eligible: true,
      grossAmount: 5940,
      feeAmount: 297,
      refundAmount: 5643,
      paidBalanceAfterRefund: 20,
      promotionRecoveryCredits: 10,
      expectedDebtIncrease: 0,
    },
  },
  PurchasesController_requestRefund: {
    auth: true,
    request: { idempotencyKey: "refund-request-01" },
    response: creditRefund,
    status: "201",
  },
  PaymentsController_handleWebhook: {
    request: { type: "checkout.updated", data: {} },
    response: { processed: true },
    status: "201",
  },

  EventsController_recordEvent: {
    auth: true,
    request: {
      eventType: "post_open",
      targetType: "post",
      targetId: "post_01",
      metadata: { source: "feed" },
    },
    response: { accepted: true },
    status: "202",
  },

  FeedController_getFeed: { auth: "optional", response: page(post) },

  FollowsController_followCharacter: {
    auth: true,
    request: { characterId: "character_01" },
    response: {
      userId: "user_01",
      characterId: "character_01",
      createdAt: isoDate,
    },
    status: "201",
  },
  FollowsController_listFollowedCharacters: {
    auth: true,
    response: [
      { userId: "user_01", characterId: "character_01", createdAt: isoDate },
    ],
  },
  FollowsController_unfollowCharacter: {
    auth: true,
    request: { characterId: "character_01" },
    response: { userId: "user_01", characterId: "character_01", deleted: true },
  },

  HealthController_getHealth: {
    response: { status: "ok", service: "ai-sns-backend" },
  },

  MessagesController_sendMessage: {
    auth: true,
    summary: "캐릭터에게 메시지 보내기 (답변은 비동기)",
    description: [
      "**응답에 캐릭터 답변은 들어 있지 않다.** `messages`에는 방금 저장한 사용자",
      "메시지 한 건만 담기고, 답변은 서버 워커가 별도로 생성해 저장한다.",
      "",
      "답변을 받으려면 `GET /messages`를 마지막 `nextCursor`로 주기적으로 조회한다.",
      "사용자 메시지의 `replyStatus`가 `pending`에서 `completed`나 `failed`로 바뀌고,",
      "`completed`면 같은 `turnId`를 가진 캐릭터 메시지가 함께 조회된다.",
      "",
      "크레딧은 전송 시점에 예약하고 답변이 성공할 때 차감한다. 답변이 최종",
      "실패하면 예약은 해제되어 차감되지 않는다.",
    ].join("\n"),
    request: { characterId: "character_01", body: "안녕" },
    response: { conversationId: "conversation_01", messages: [message] },
    status: "201",
    errors: {
      "400": { description: "본문이 비었거나 존재하지 않는 캐릭터" },
      "402": {
        description: "가용 크레딧 부족. 메시지는 저장되지 않는다",
        example: insufficientCredits,
      },
    },
  },
  MessagesController_listConversations: {
    auth: true,
    summary: "대화 목록",
    description: [
      "마지막 활동 시각 내림차순. `unreadCount`는 마지막 읽음 이후 도착한 **캐릭터**",
      "메시지 수이며, 사용자 자신이 보낸 메시지는 세지 않는다.",
    ].join("\n"),
    response: page({
      conversationId: "conversation_01",
      character,
      lastMessage: characterMessage,
      unreadCount: 1,
    }),
  },
  MessagesController_getMessages: {
    auth: true,
    summary: "대화 메시지 조회 (답변 폴링 경로)",
    description: [
      "오래된 메시지부터의 cursor 페이지네이션. 새 메시지 폴링에 같은 엔드포인트를",
      "쓴다 — 마지막 `nextCursor`를 넘기면 그 이후만 돌아온다.",
      "",
      "`replyStatus`는 그 메시지가 속한 턴의 답변 상태다.",
      "`pending`(생성 대기·진행 중) · `completed`(답변 저장됨) ·",
      "`failed`(최종 실패, `POST /messages/retry`로 재시도 가능).",
      "비동기 전환 이전에 저장된 메시지에는 `turnId`와 `replyStatus`가 없다.",
      "",
      "답변이 늦게 도착하므로 시간순 목록에서 답변이 그다음 질문보다 뒤에 올 수",
      "있다. 어떤 답변이 어떤 질문의 것인지는 순서가 아니라 `turnId`로 판단한다.",
    ].join("\n"),
    response: page(characterMessage),
  },
  MessagesController_markConversationRead: {
    auth: true,
    summary: "대화 읽음 처리",
    description: [
      "앱이 대화를 실제로 화면에 보여줬을 때 호출한다. 메시지 조회와 전송은 읽음을",
      "찍지 않으므로, 이 호출을 빠뜨리면 `unreadCount`가 줄지 않는다.",
    ].join("\n"),
    request: { characterId: "character_01" },
    response: { conversationId: "conversation_01", lastReadAt: isoDate },
    status: "201",
    errors: {
      "404": { description: "아직 시작하지 않은 대화" },
    },
  },
  MessagesController_retryReply: {
    auth: true,
    summary: "실패한 답변 재시도",
    description: [
      "`replyStatus`가 `failed`인 본인 턴만 다시 큐에 넣는다. 새 크레딧 예약을",
      "만들고 해당 대화의 마지막 순서로 배치하므로, 대기 중인 다른 턴이 있으면",
      "그 뒤에 처리된다.",
      "",
      "202는 재등록까지만 뜻한다. 결과는 `GET /messages` 폴링으로 확인한다.",
      "같은 턴에 재시도를 동시에 여러 번 보내도 작업과 예약은 하나만 생긴다.",
    ].join("\n"),
    request: { turnId: "message_01" },
    response: { turnId: "message_01", replyStatus: "pending" },
    status: "202",
    errors: {
      "402": {
        description: "가용 크레딧 부족",
        example: insufficientCredits,
      },
      "404": { description: "없는 턴이거나 다른 사용자의 대화" },
      "409": {
        description: "이미 처리 중(`pending`)이거나 성공한(`completed`) 턴",
      },
    },
  },

  NotificationsController_listNotifications: {
    auth: true,
    response: page(notification),
  },
  NotificationsController_markNotificationRead: {
    auth: true,
    response: { id: "notification_01", readAt: isoDate },
  },

  PostsController_listPosts: { response: page(post) },
  PostsController_listPostComments: { response: page(postComment) },
  PostsController_createPostComment: {
    auth: true,
    request: { body: "좋아요" },
    response: postComment,
    status: "201",
  },
  PostsController_listPostReactions: {
    response: {
      items: [postReaction],
      counts: { like: 12 },
    },
  },
  PostsController_createPostReaction: {
    auth: true,
    request: { reactionType: "like" },
    response: postReaction,
    status: "201",
  },
  PostsController_deletePostReaction: {
    auth: true,
    request: { reactionType: "like" },
    response: {
      postId: "post_01",
      userId: "user_01",
      reactionType: "like",
      deleted: true,
    },
  },
  PostsController_getPost: { response: post },

  ReportsController_createReport: {
    auth: true,
    request: {
      targetType: "post",
      targetId: "post_01",
      reason: "spam",
      details: "광고성 게시물",
    },
    response: { id: "report_01", status: "submitted", createdAt: isoDate },
    status: "201",
  },
  ReportsController_getReport: { auth: true, response: report },

  InquiriesController_createInquiry: {
    auth: true,
    request: { category: "credit", body: "결제했는데 크레딧이 안 들어와요." },
    response: {
      id: "inquiry_01",
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
      status: "submitted",
      answeredAt: null,
      createdAt: isoDate,
    },
    status: "201",
  },
  InquiriesController_listInquiries: {
    auth: true,
    response: page({
      id: "inquiry_01",
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
      status: "submitted",
      answeredAt: null,
      createdAt: isoDate,
    }),
  },
  InquiriesController_getInquiry: {
    auth: true,
    response: {
      id: "inquiry_01",
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
      status: "answered",
      answerBody: "확인 후 크레딧을 지급해 드렸어요.",
      answeredAt: isoDate,
      createdAt: isoDate,
    },
  },
  InquiriesController_deleteInquiry: {
    auth: true,
    response: { deleted: true },
  },
  NoticesController_listNotices: {
    response: {
      pinned: [
        {
          id: "notice_01",
          title: "서비스 점검 안내",
          isPinned: true,
          publishedAt: isoDate,
        },
      ],
      items: [
        {
          id: "notice_02",
          title: "업데이트 소식",
          isPinned: false,
          publishedAt: isoDate,
        },
      ],
      nextCursor: "cursor_abc123",
    },
  },
  NoticesController_getNotice: {
    response: {
      id: "notice_01",
      title: "서비스 점검 안내",
      body: "7월 10일 새벽 2시부터 점검이 진행됩니다.",
      isPinned: true,
      publishedAt: isoDate,
    },
  },
  FaqsController_listFaqs: {
    response: {
      items: [
        {
          id: "faq_01",
          category: "credit",
          question: "크레딧은 어떻게 충전하나요?",
          answer: "크레딧 탭에서 패키지를 선택해 충전할 수 있어요.",
          sortOrder: 0,
        },
      ],
    },
  },

  TermsController_listTerms: {
    response: [
      {
        type: "terms_of_service",
        version: "1.0",
        title: "서비스 이용약관",
        required: true,
        effectiveAt: isoDate,
      },
      {
        type: "marketing",
        version: "1.0",
        title: "광고성 정보 수신 동의",
        required: false,
        effectiveAt: isoDate,
      },
    ],
  },
  TermsController_getTerms: {
    response: {
      type: "terms_of_service",
      version: "1.0",
      title: "서비스 이용약관",
      required: true,
      effectiveAt: isoDate,
      body: "제1조(목적) ...",
    },
  },
  ConsentsController_listConsents: {
    auth: true,
    response: [
      {
        type: "terms_of_service",
        required: true,
        agreed: true,
        agreedVersion: "1.0",
        currentVersion: "2.0",
        needsConsent: true,
      },
      {
        type: "marketing",
        required: false,
        agreed: false,
        agreedVersion: "1.0",
        currentVersion: "1.0",
        needsConsent: false,
      },
    ],
  },
  ConsentsController_updateConsents: {
    auth: true,
    request: {
      consents: [
        { type: "terms_of_service", agreed: true },
        { type: "marketing", agreed: true },
      ],
    },
    response: [
      {
        type: "terms_of_service",
        required: true,
        agreed: true,
        agreedVersion: "2.0",
        currentVersion: "2.0",
        needsConsent: false,
      },
      {
        type: "marketing",
        required: false,
        agreed: true,
        agreedVersion: "1.0",
        currentVersion: "1.0",
        needsConsent: false,
      },
    ],
  },

  SearchController_search: {
    response: { characters: [character], posts: [post], hashtags: ["travel"] },
  },
  HashtagsController_listHashtagPosts: { response: page(post) },
  StoriesController_listStories: { response: page(story) },
};

function addDomainTags(document: OpenApiDocument) {
  document.tags = serviceTags;
}

function addOperationExamples(document: OpenApiDocument) {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    const tag = tagForPath(path);

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isHttpMethod(method) || !isOperation(operation)) {
        continue;
      }

      if (tag) {
        operation.tags = [tag];
      }

      const example = operation.operationId
        ? operationExamples[operation.operationId]
        : undefined;
      if (!example) {
        continue;
      }

      if (example.auth) {
        addAuth(operation, example.auth === "optional");
      }
      if (example.summary) {
        operation.summary = example.summary;
      }
      if (example.description) {
        operation.description = example.description;
      }
      if (example.request !== undefined) {
        operation.requestBody = jsonContentWithExample(
          operation.requestBody,
          example.request,
          true,
        );
      }
      if (example.response !== undefined) {
        addResponseExample(operation, example.status, example.response);
      }
      if (example.errors) {
        addErrorResponses(operation, example.errors);
      }
    }
  }
}

function tagForPath(path: string) {
  const segment = path.split("/").filter(Boolean)[0];
  return segment ? tagByPathSegment[segment] : undefined;
}

function isHttpMethod(method: string) {
  return [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
    "trace",
  ].includes(method);
}

function isOperation(value: unknown): value is OpenApiOperation {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addAuth(operation: OpenApiOperation, optional: boolean) {
  if (!optional) {
    operation.security = [{ bearer: [] }];
  }
  operation.parameters = [
    ...(operation.parameters ?? []).filter((parameter) => {
      const record = toRecord(parameter);
      return !(
        record.in === "header" &&
        String(record.name).toLowerCase() === "authorization"
      );
    }),
    {
      name: "Authorization",
      in: "header",
      required: !optional,
      description: optional
        ? "선택 JWT access token. Example: Bearer <accessToken>"
        : "JWT access token. Example: Bearer <accessToken>",
      schema: { type: "string", example: "Bearer eyJhbGciOi..." },
    },
  ];
}

function addResponseExample(
  operation: OpenApiOperation,
  preferredStatus: string | undefined,
  example: unknown,
) {
  const responses = operation.responses ?? {};
  const status = preferredStatus ?? firstResponseStatus(responses) ?? "200";
  const existing = toRecord(responses[status]);

  operation.responses = {
    ...responses,
    [status]: {
      description:
        typeof existing.description === "string"
          ? existing.description
          : "Success",
      ...jsonContentWithExample(existing, example, false),
    },
  };
}

function addErrorResponses(
  operation: OpenApiOperation,
  errors: NonNullable<OperationExample["errors"]>,
) {
  const responses = operation.responses ?? {};

  for (const [status, error] of Object.entries(errors)) {
    responses[status] = {
      description: error.description,
      ...(error.example === undefined
        ? {}
        : jsonContentWithExample({}, error.example, false)),
    };
  }
  operation.responses = responses;
}

function firstResponseStatus(responses: Record<string, unknown>) {
  return (
    Object.keys(responses).find((status) => status.startsWith("2")) ??
    Object.keys(responses)[0]
  );
}

function jsonContentWithExample(
  value: unknown,
  example: unknown,
  required: boolean,
) {
  const container = toRecord(value);
  const content = toRecord(container.content);
  const json = toRecord(content["application/json"]);

  return {
    ...container,
    ...(required ? { required: true } : {}),
    content: {
      ...content,
      "application/json": {
        ...json,
        schema: json.schema ?? schemaFromExample(example),
        example,
      },
    },
  };
}

function schemaFromExample(example: unknown): Record<string, unknown> {
  if (Array.isArray(example)) {
    return {
      type: "array",
      items: schemaFromExample(example[0] ?? {}),
    };
  }
  if (example === null) {
    return { nullable: true };
  }
  if (typeof example === "boolean") {
    return { type: "boolean", example };
  }
  if (typeof example === "number") {
    return {
      type: Number.isInteger(example) ? "integer" : "number",
      example,
    };
  }
  if (typeof example === "string") {
    return { type: "string", example };
  }
  if (typeof example === "object" && example !== null) {
    const entries = Object.entries(example);
    return {
      type: "object",
      properties: Object.fromEntries(
        entries.map(([key, value]) => [key, schemaFromExample(value)]),
      ),
      required: entries
        .filter(([, value]) => value !== null)
        .map(([key]) => key),
    };
  }
  return {};
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
