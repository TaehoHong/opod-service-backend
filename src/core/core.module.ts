import { Module, ValidationPipe } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ServiceAuthModule } from "../auth/auth.http.module";
import { ServiceCharactersModule } from "../characters/characters.http.module";
import { ServiceConsentsModule } from "../consents/consents.http.module";
import { ServiceCreditsModule } from "../credits/credits.http.module";
import { ServiceEventsModule } from "../events/events.http.module";
import { ServiceFaqsModule } from "../faqs/faqs.http.module";
import { ServiceFeedModule } from "../feed/feed.http.module";
import { ServiceFollowsModule } from "../follows/follows.http.module";
import { ServiceHealthModule } from "../health/health.module";
import { ServiceInquiriesModule } from "../inquiries/inquiries.http.module";
import { ServiceMessagesModule } from "../messages/messages.http.module";
import { ServiceNoticesModule } from "../notices/notices.http.module";
import { ServiceNotificationsModule } from "../notifications/notifications.http.module";
import { ServicePostsModule } from "../posts/posts.http.module";
import { ServicePaymentsModule } from "../payments/payments.http.module";
import { ServicePurchasesModule } from "../purchases/purchases.http.module";
import { RequestLoggingInterceptor } from "../shared/interceptors/request-logging.interceptor";
import { ServiceReportsModule } from "../reports/reports.http.module";
import { ServiceSearchModule } from "../search/search.module";
import { ServiceStoriesModule } from "../stories/stories.http.module";

@Module({
  imports: [
    ServiceAuthModule,
    ServiceCharactersModule,
    ServiceConsentsModule,
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
    ServicePaymentsModule,
    ServicePurchasesModule,
    ServiceReportsModule,
    ServiceSearchModule,
    ServiceStoriesModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class CoreModule {}
