import {
  ArgumentsHost,
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AiUnavailableException } from '../../../../src/common/errors/ai-unavailable.exception';
import { ErrorCode } from '../../../../src/common/errors/error-code.enum';
import { AllExceptionsFilter } from '../../../../src/common/filters/all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const response = {};
  let reply: jest.Mock;
  let filter: AllExceptionsFilter;
  let errorLog: jest.SpyInstance;

  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  // Run the filter and return what it sent: [body, status].
  function run(exception: unknown): [unknown, number] {
    filter.catch(exception, host);
    const [, body, status] = reply.mock.calls[0] as [unknown, unknown, number];
    return [body, status];
  }

  beforeEach(() => {
    reply = jest.fn();
    filter = new AllExceptionsFilter({
      httpAdapter: { reply },
    } as unknown as HttpAdapterHost);
    // Keep test output clean.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('replies on the response object it was given', () => {
    filter.catch(new NotFoundException(), host);
    expect(reply).toHaveBeenCalledWith(response, expect.anything(), 404);
  });

  it('maps NotFoundException and keeps its message', () => {
    const [body, status] = run(new NotFoundException('Email not found'));

    expect(status).toBe(404);
    expect(body).toEqual({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Email not found',
        details: null,
      },
    });
  });

  it('puts ValidationPipe messages into details', () => {
    const [body, status] = run(
      new BadRequestException([
        'name must be a string',
        'age must be a number',
      ]),
    );

    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: ['name must be a string', 'age must be a number'],
      },
    });
  });

  it('hides the message and stack of unexpected errors', () => {
    const [body, status] = run(new Error('connection refused to db:5432'));

    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        details: null,
      },
    });
    expect(JSON.stringify(body)).not.toContain('5432');
    expect(errorLog).toHaveBeenCalled();
  });

  it('handles a thrown non-Error value', () => {
    const [body, status] = run('boom');

    expect(status).toBe(500);
    expect(body).toMatchObject({ error: { code: ErrorCode.INTERNAL_ERROR } });
  });

  it('uses AI_UNAVAILABLE only for AiUnavailableException', () => {
    const [aiBody] = run(new AiUnavailableException());
    expect(aiBody).toMatchObject({
      error: { code: ErrorCode.AI_UNAVAILABLE },
    });

    reply.mockClear();
    const [plainBody, plainStatus] = run(new ServiceUnavailableException());
    expect(plainStatus).toBe(503);
    expect(plainBody).toMatchObject({
      error: { code: ErrorCode.SERVICE_UNAVAILABLE },
    });
  });

  it.each([
    [new ForbiddenException(), 403, ErrorCode.FORBIDDEN],
    [new BadGatewayException(), 502, ErrorCode.UPSTREAM_ERROR],
    [
      new HttpException('Slow down', HttpStatus.TOO_MANY_REQUESTS),
      429,
      ErrorCode.RATE_LIMIT_EXCEEDED,
    ],
  ])('maps %#: status %s to its code', (exception, expectedStatus, code) => {
    const [body, status] = run(exception);
    expect(status).toBe(expectedStatus);
    expect(body).toMatchObject({ error: { code } });
  });

  it('falls back to VALIDATION_ERROR for an unmapped 4xx', () => {
    const [body, status] = run(new PayloadTooLargeException());

    expect(status).toBe(413);
    expect(body).toMatchObject({
      error: { code: ErrorCode.VALIDATION_ERROR },
    });
  });

  it('falls back to INTERNAL_ERROR for an unmapped 5xx', () => {
    const [body, status] = run(new GatewayTimeoutException());

    expect(status).toBe(504);
    expect(body).toMatchObject({
      error: { code: ErrorCode.INTERNAL_ERROR },
    });
  });
});
