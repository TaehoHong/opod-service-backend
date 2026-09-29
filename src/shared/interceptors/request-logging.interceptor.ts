import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, catchError, finalize, throwError } from "rxjs";

type RequestLike = {
  method?: string;
  originalUrl?: string;
  url?: string;
};

type ResponseLike = {
  statusCode?: number;
};

// ponytail: 성공한 읽기 요청은 로그로 남기지 않는다 (GCP DATA_READ / CloudTrail data event와
// 같은 기본값). 실패는 메서드와 무관하게 남긴다. 개인정보 조회 이력이 필요해지면 그건 이
// 인터셉터가 아니라 console_logs에 대상 정보주체와 함께 기록할 것.
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const response = http.getResponse<ResponseLike>();
    const method = request.method ?? "UNKNOWN";
    const url = request.originalUrl ?? request.url ?? "/";
    const startedAt = Date.now();
    const isWrite = !READ_METHODS.has(method);
    let failed = false;

    if (isWrite) {
      this.logger.log(`API request ${method} ${url}`);
    }

    return next.handle().pipe(
      catchError((error: unknown) => {
        failed = true;
        const durationMs = Date.now() - startedAt;
        const statusCode =
          error instanceof HttpException
            ? error.getStatus()
            : (response.statusCode ?? 500);
        const errorName = error instanceof Error ? error.name : "UnknownError";
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;

        this.logger.error(
          `API error ${method} ${url} ${statusCode} ${durationMs}ms ${errorName}: ${errorMessage}`,
          stack,
        );

        return throwError(() => error);
      }),
      finalize(() => {
        if (failed || !isWrite) {
          return;
        }

        const durationMs = Date.now() - startedAt;
        this.logger.log(
          `API response ${method} ${url} ${response.statusCode ?? 0} ${durationMs}ms`,
        );
      }),
    );
  }
}
