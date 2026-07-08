import { HttpException, HttpStatus } from "@nestjs/common";

export class InsufficientCreditsException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        message: "Insufficient credits",
        error: "INSUFFICIENT_CREDITS",
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
