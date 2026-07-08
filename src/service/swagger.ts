import { INestApplication, Type } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

type OpenApiDocument = {
  components?: Record<string, unknown>;
  paths: Record<string, Record<string, OpenApiOperation | unknown>>;
  tags?: OpenApiTag[];
};

type OpenApiOperation = {
  operationId?: string;
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

type OperationSchema = {
  auth?: boolean;
  request?: unknown;
  response?: unknown;
  status?: string;
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
  addRequestResponseSchemas(openApiDocument);

  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: {
      docExpansion: "none",
      operationsSorter: "alpha",
      persistAuthorization: true,
      tagsSorter: sortSwaggerTags,
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
  { name: "크레딧", description: "크레딧 결제와 사용 내역 API" },
  { name: "알림", description: "사용자 알림 API" },
  { name: "신고", description: "콘텐츠 신고 API" },
  { name: "고객지원", description: "FAQ, 공지사항, 1:1 문의 API" },
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
  notifications: "알림",
  reports: "신고",
  faqs: "고객지원",
  notices: "고객지원",
  inquiries: "고객지원",
  search: "검색",
  hashtags: "검색",
  events: "이벤트",
  health: "시스템",
};

const isoDate = "2026-07-05T08:00:00.000Z";
const user = {
  id: "user_01",
  displayName: "홍태호",
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
  content: "오늘의 기록",
  media: [media],
  hashtags: ["travel"],
  createdAt: isoDate,
};
const message = {
  id: "message_01",
  conversationId: "conversation_01",
  senderType: "user",
  body: "안녕",
  createdAt: isoDate,
};
const creditEntry = {
  id: "credit_entry_01",
  userId: "user_01",
  entryType: "debit",
  amount: 10,
  reason: "message",
  externalReference: "message_01",
  createdAt: isoDate,
};
const creditPurchase = {
  id: "purchase_01",
  provider: "local",
  status: "pending",
  creditAmount: 100,
  paidAmount: 9900,
  currency: "KRW",
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

const operationSchemas: Record<string, OperationSchema> = {
  AuthController_register: {
    request: {
      email: "taeho@example.com",
      password: "password1234",
      displayName: "홍태호",
    },
    response: authTokens,
    status: "201",
  },
  AuthController_login: {
    request: { email: "taeho@example.com", password: "password1234" },
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
    request: { displayName: "새 이름" },
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
  AuthController_revokeSession: {
    request: { refreshToken: "refresh_abc123" },
    response: { revoked: true },
  },

  CharactersController_listCharacters: { response: [character] },
  CharactersController_getCharacter: { response: character },
  CharactersController_listCharacterPosts: { response: page(post) },
  CharactersController_getCharacterRelationship: {
    auth: true,
    response: {
      characterId: "character_01",
      isFollowing: true,
      followedAt: isoDate,
    },
  },

  CreditsController_createCheckout: {
    auth: true,
    request: { creditPackageId: "credits_100" },
    response: {
      checkoutId: "purchase_01",
      provider: "local",
      checkoutUrl: "https://payments.local/checkout/purchase_01",
    },
    status: "201",
  },
  CreditsController_handlePaymentWebhook: {
    request: { checkoutId: "purchase_01", status: "paid" },
    response: { received: true },
    status: "201",
  },
  CreditsController_spendCredits: {
    auth: true,
    request: { amount: 10, reason: "message" },
    response: creditEntry,
    status: "201",
  },
  CreditsController_getBalance: {
    auth: true,
    response: { userId: "user_01", balance: 90 },
  },
  CreditsController_listEntries: { auth: true, response: page(creditEntry) },
  CreditsController_listPurchases: {
    auth: true,
    response: page(creditPurchase),
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

  FeedController_getFeed: { auth: true, response: page(post) },

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
    request: { characterId: "character_01", body: "안녕" },
    response: { conversationId: "conversation_01", messages: [message] },
    status: "201",
  },
  MessagesController_listConversations: {
    auth: true,
    response: page({
      conversationId: "conversation_01",
      character,
      lastMessage: message,
      unreadCount: 0,
    }),
  },
  MessagesController_getMessages: { auth: true, response: page(message) },

  NotificationsController_listNotifications: {
    auth: true,
    response: page(notification),
  },
  NotificationsController_markNotificationRead: {
    auth: true,
    response: { id: "notification_01", readAt: isoDate },
  },

  PostsController_listPosts: { response: page(post) },
  PostsController_listPostComments: {
    response: page({
      id: "comment_01",
      postId: "post_01",
      characterId: "character_02",
      body: "좋아요",
      createdAt: isoDate,
    }),
  },
  PostsController_listPostReactions: {
    response: [
      {
        id: "reaction_01",
        postId: "post_01",
        characterId: "character_02",
        reactionType: "like",
        createdAt: isoDate,
      },
    ],
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

  SearchController_search: {
    response: { characters: [character], posts: [post], hashtags: ["travel"] },
  },
  HashtagsController_listHashtagPosts: { response: page(post) },
};

function addRequestResponseSchemas(document: OpenApiDocument) {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    const tag = tagForPath(path);
    for (const operation of Object.values(pathItem)) {
      if (!isOperation(operation)) {
        continue;
      }

      if (tag) {
        operation.tags = [tag];
      }

      const schema = operation.operationId
        ? operationSchemas[operation.operationId]
        : undefined;
      if (!schema) {
        continue;
      }

      if (schema.auth) {
        addAuth(operation);
      }
      if (schema.request !== undefined) {
        operation.requestBody = jsonContent(schema.request, true);
      }
      if (schema.response !== undefined) {
        addResponse(operation, schema.status, schema.response);
      }
    }
  }
}

function addDomainTags(document: OpenApiDocument) {
  document.tags = serviceTags;
}

function tagForPath(path: string) {
  const segment = path.split("/").filter(Boolean)[0];
  return segment ? tagByPathSegment[segment] : undefined;
}

function sortSwaggerTags(left: string, right: string) {
  const order = [
    "인증",
    "캐릭터",
    "피드",
    "게시글",
    "팔로우",
    "메시지",
    "크레딧",
    "알림",
    "신고",
    "고객지원",
    "검색",
    "이벤트",
    "시스템",
  ];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);

  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }
  if (leftIndex === -1) {
    return 1;
  }
  if (rightIndex === -1) {
    return -1;
  }
  return leftIndex - rightIndex;
}

function isOperation(value: unknown): value is OpenApiOperation {
  return typeof value === "object" && value !== null && "operationId" in value;
}

function addAuth(operation: OpenApiOperation) {
  operation.security = [{ bearer: [] }];
  operation.parameters = [
    ...(operation.parameters ?? []).filter(
      (parameter) =>
        !(
          typeof parameter === "object" &&
          parameter !== null &&
          "in" in parameter &&
          "name" in parameter &&
          parameter.in === "header" &&
          String(parameter.name).toLowerCase() === "authorization"
        ),
    ),
    {
      name: "Authorization",
      in: "header",
      required: true,
      description: "JWT access token. Example: Bearer <accessToken>",
      schema: { type: "string", example: "Bearer eyJhbGciOi..." },
    },
  ];
}

function addResponse(
  operation: OpenApiOperation,
  preferredStatus: string | undefined,
  example: unknown,
) {
  const status =
    preferredStatus ?? Object.keys(operation.responses ?? {})[0] ?? "200";
  const existing = operation.responses?.[status];

  operation.responses = {
    ...(operation.responses ?? {}),
    [status]: {
      ...(typeof existing === "object" && existing !== null ? existing : {}),
      description: "Success",
      ...jsonContent(example, false),
    },
  };
}

function jsonContent(example: unknown, required: boolean) {
  return {
    ...(required ? { required: true } : {}),
    content: {
      "application/json": {
        schema: schemaFromExample(example),
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
