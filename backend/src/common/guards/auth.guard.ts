import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthMode } from '../../config/auth-mode.enum';
import { EnvironmentVariables } from '../../config/env.validation';
import { DEMO_USER_EMAIL } from '../../database/demo-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class AuthGuard implements CanActivate {
  private demoUserId?: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.config.get('AUTH_MODE', { infer: true }) === AuthMode.DEMO) {
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      request.userId = await this.getDemoUserId();
      return true;
    }

    throw new UnauthorizedException(); // session auth arrives in Milestone 6
  }

  private async getDemoUserId(): Promise<string> {
    if (this.demoUserId) return this.demoUserId;
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM users WHERE email = $1`,
      [DEMO_USER_EMAIL],
    );
    if (!rows[0]) {
      throw new ServiceUnavailableException(
        'Demo user missing. Run npm run db:seed',
      );
    }
    return (this.demoUserId = rows[0].id);
  }
}
