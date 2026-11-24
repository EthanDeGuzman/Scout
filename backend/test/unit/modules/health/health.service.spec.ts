import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthService } from '../../../../src/modules/health/health.service';

describe('HealthService', () => {
  let query: jest.Mock;
  let service: HealthService;

  beforeEach(() => {
    query = jest.fn();
    service = new HealthService({ query } as unknown as DataSource);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns true when SELECT 1 succeeds', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.checkDatabase()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns false when the query fails', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    await expect(service.checkDatabase()).resolves.toBe(false);
  });

  it('returns false when the query hangs past the timeout', async () => {
    jest.useFakeTimers();
    query.mockReturnValue(new Promise(() => {})); // never settles

    const result = service.checkDatabase();
    await jest.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toBe(false);
  });
});
