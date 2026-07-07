import {
  CallHandler,
  ExecutionContext,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { firstValueFrom, of, throwError } from "rxjs";
import { RequestLoggingInterceptor } from "./request-logging.interceptor";

function createHttpContext(
  request: { method?: string; originalUrl?: string; url?: string },
  response: { statusCode?: number },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

describe("RequestLoggingInterceptor", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("logs API calls and responses", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_017);
    const logSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const interceptor = new RequestLoggingInterceptor();
    const context = createHttpContext(
      { method: "GET", originalUrl: "/health" },
      { statusCode: 200 },
    );
    const next: CallHandler = { handle: () => of({ status: "ok" }) };

    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).resolves.toEqual({ status: "ok" });

    expect(logSpy).toHaveBeenCalledWith("API request GET /health");
    expect(logSpy).toHaveBeenCalledWith("API response GET /health 200 17ms");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs API errors", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_023);
    const logSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const interceptor = new RequestLoggingInterceptor();
    const context = createHttpContext(
      { method: "POST", url: "/logging-test/error" },
      { statusCode: 500 },
    );
    const error = new InternalServerErrorException("boom");
    const next: CallHandler = {
      handle: () => throwError(() => error),
    };

    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toBe(error);

    expect(logSpy).toHaveBeenCalledWith("API request POST /logging-test/error");
    expect(errorSpy).toHaveBeenCalledWith(
      "API error POST /logging-test/error 500 23ms InternalServerErrorException: boom",
      expect.any(String),
    );
  });
});
