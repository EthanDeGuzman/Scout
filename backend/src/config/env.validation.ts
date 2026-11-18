import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';
import { AuthMode } from './auth-mode.enum';
import { NodeEnv } from './node-env.enum';

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  SESSION_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  TOKEN_ENCRYPTION_KEY!: string;

  @IsEnum(AuthMode)
  AUTH_MODE!: AuthMode;

  @IsUrl({ require_tld: false, require_protocol: true })
  OLLAMA_BASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  OLLAMA_MODEL!: string;

  @IsInt()
  @Min(1000)
  OLLAMA_TIMEOUT_MS!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  CLASSIFICATION_REVIEW_THRESHOLD!: number;

  @ValidateIf((o: EnvironmentVariables) => o.AUTH_MODE === AuthMode.MICROSOFT)
  @IsString()
  @IsNotEmpty()
  MS_CLIENT_ID!: string;

  @ValidateIf((o: EnvironmentVariables) => o.AUTH_MODE === AuthMode.MICROSOFT)
  @IsString()
  @IsNotEmpty()
  MS_CLIENT_SECRET!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  MS_AUTHORITY!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  MS_REDIRECT_URI!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  FRONTEND_URL!: string;

  @IsInt()
  @Min(1)
  SYNC_LOOKBACK_DAYS!: number;

  @IsInt()
  @Min(0)
  SYNC_INTERVAL_MINUTES!: number;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(`Invalid environment variables:\n${messages.join('\n')}`);
  }

  return validatedConfig;
}
