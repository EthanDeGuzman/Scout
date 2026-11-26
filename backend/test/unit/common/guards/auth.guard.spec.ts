import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../../../src/common/guards/auth.guard';
import { AuthenticatedRequest } from '../../../../src/common/guards/authenticated-request';
import { AuthMode } from '../../../../src/config/auth-mode.enum';
import { EnvironmentVariables } from '../../../../src/config/env.validation';

describe('AuthGuard', () => {
  const getAllAndOverride = jest.fn();
  const configGet = jest.fn();
  const query = jest.fn();
  let guard: AuthGuard;

  /** Minimal fake of the ExecutionContext the guard reads from. */
  const contextFor = (request: Partial<AuthenticatedRequest>) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
    getAllAndOverride.mockReturnValue(false);
    configGet.mockReturnValue(AuthMode.DEMO);

    guard = new AuthGuard(
      { getAllAndOverride } as unknown as Reflector,
      { get: configGet } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
      { query } as unknown as DataSource,
    );
  });

  it('lets @Public() routes through without touching the database', async () => {
    getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('in demo mode, puts the demo user id on the request', async () => {
    query.mockResolvedValue([{ id: 'user-1' }]);
    const request: Partial<AuthenticatedRequest> = {};

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.userId).toBe('user-1');
  });

  it('looks the demo user up with a parameterised query', async () => {
    query.mockResolvedValue([{ id: 'user-1' }]);

    await guard.canActivate(contextFor({}));

    expect(query).toHaveBeenCalledWith(expect.stringContaining('$1'), [
      'demo@scout.local',
    ]);
  });

  it('looks the demo user up only once', async () => {
    query.mockResolvedValue([{ id: 'user-1' }]);

    await guard.canActivate(contextFor({}));
    await guard.canActivate(contextFor({}));

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailable when the demo user is not seeded', async () => {
    query.mockResolvedValue([]);

    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws Unauthorized in microsoft mode (not built yet)', async () => {
    configGet.mockReturnValue(AuthMode.MICROSOFT);

    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
