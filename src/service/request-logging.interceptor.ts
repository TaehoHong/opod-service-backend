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
    let failed = false;

    this.logger.log(`API request ${method} ${url}`);

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
        if (failed) {
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
