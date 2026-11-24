import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { AiUnavailableException } from '../errors/ai-unavailable.exception';
import { ErrorCode } from '../errors/error-code.enum';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMIT_EXCEEDED,
  [HttpStatus.BAD_GATEWAY]: ErrorCode.UPSTREAM_ERROR,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

interface ErrorParts {
  status: number;
  code: ErrorCode;
  message: string;
  details: string[] | null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const response = host.switchToHttp().getResponse<unknown>();

    const { status, code, message, details } = this.toErrorParts(exception);
    this.log(exception, status);

    const payload: ErrorResponseDto = { error: { code, message, details } };
    httpAdapter.reply(response, payload, status);
  }

  private toErrorParts(exception: unknown): ErrorParts {
    // Not thrown on purpose (a bug, a DB failure): never leak internals.
    if (!(exception instanceof HttpException)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        details: null,
      };
    }

    const status = exception.getStatus();
    const { message, details } = this.readMessage(exception);

    return {
      status,
      code: this.resolveCode(exception, status),
      message,
      details,
    };
  }

  private resolveCode(exception: HttpException, status: number): ErrorCode {
    // Specific exception classes win over the generic status mapping.
    if (exception instanceof AiUnavailableException) {
      return ErrorCode.AI_UNAVAILABLE;
    }
    const mapped = STATUS_TO_CODE[status];
    if (mapped) return mapped;

    // Unmapped status: don't call a client mistake an internal error.
    return status >= 500
      ? ErrorCode.INTERNAL_ERROR
      : ErrorCode.VALIDATION_ERROR;
  }

  private readMessage(exception: HttpException): {
    message: string;
    details: string[] | null;
  } {
    const body = exception.getResponse();

    if (typeof body === 'string') {
      return { message: body, details: null };
    }

    const raw = (body as { message?: unknown }).message;

    // ValidationPipe returns one string per failed rule.
    if (Array.isArray(raw)) {
      return {
        message: 'Validation failed',
        details: raw.filter((m): m is string => typeof m === 'string'),
      };
    }
    if (typeof raw === 'string') {
      return { message: raw, details: null };
    }
    return { message: exception.message, details: null };
  }

  private log(exception: unknown, status: number): void {
    // Full detail stays server-side; never send stack traces to the client.
    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${status}: ${exception instanceof Error ? exception.message : String(exception)}`,
      );
    }
  }
}
