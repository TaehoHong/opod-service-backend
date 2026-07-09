import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ServiceAuthModule } from "./auth/auth.module";
import { ServiceCharactersModule } from "./characters/characters.module";
import { ServiceCreditsModule } from "./credits/credits.module";
import { ServiceEventsModule } from "./events/events.module";
import { ServiceFaqsModule } from "./faqs/faqs.module";
import { ServiceFeedModule } from "./feed/feed.module";
import { ServiceFollowsModule } from "./follows/follows.module";
import { ServiceHealthModule } from "./health/health.module";
import { ServiceInquiriesModule } from "./inquiries/inquiries.module";
import { ServiceMessagesModule } from "./messages/messages.module";
import { ServiceNoticesModule } from "./notices/notices.module";
import { ServiceNotificationsModule } from "./notifications/notifications.module";
import { ServicePostsModule } from "./posts/posts.module";
import { RequestLoggingInterceptor } from "./request-logging.interceptor";
import { ServiceReportsModule } from "./reports/reports.module";
import { ServiceSearchModule } from "./search/search.module";
import { ServiceStoriesModule } from "./stories/stories.module";

@Module({
  imports: [
    ServiceAuthModule,
    ServiceCharactersModule,
    ServiceCreditsModule,
    ServiceEventsModule,
    ServiceFaqsModule,
    ServiceFeedModule,
    ServiceFollowsModule,
    ServiceHealthModule,
    ServiceInquiriesModule,
    ServiceMessagesModule,
    ServiceNoticesModule,
    ServiceNotificationsModule,
    ServicePostsModule,
    ServiceReportsModule,
    ServiceSearchModule,
    ServiceStoriesModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class ServiceModule {}
