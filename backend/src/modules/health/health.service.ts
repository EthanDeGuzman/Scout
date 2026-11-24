import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly dataSource: DataSource) {}

  async checkDatabase(): Promise<boolean> {
    try {
      await this.withTimeout(
        this.dataSource.query('SELECT 1'),
        CHECK_TIMEOUT_MS,
      );
      return true;
    } catch (err) {
      this.logger.error(
        'Database health check failed',
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }

  // A stuck database must not make the health request hang too.
  // Note: this stops waiting; it does not cancel the query itself.
  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out after ${ms}ms`)),
        ms,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
