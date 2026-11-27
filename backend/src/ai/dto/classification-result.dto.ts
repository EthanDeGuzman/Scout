import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EmailCategory } from '../../modules/emails/email-category.enum';
import {
  ClassificationResult,
  ExtractedDetails,
} from '../ai-provider.interface';

/** Job details the model may pull out of an email. null = not stated. */
export class ExtractedDetailsDto implements ExtractedDetails {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  jobTitle!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  salary!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  recruiterName!: string | null;
}

/** What the model must return. Validated after JSON.parse; never trusted. */
export class ClassificationResultDto implements Pick<
  ClassificationResult,
  'category' | 'confidence' | 'requiresAction' | 'reason' | 'extracted'
> {
  @IsEnum(EmailCategory)
  category!: EmailCategory;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number;

  @IsBoolean()
  requiresAction!: boolean;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @ValidateNested()
  @Type(() => ExtractedDetailsDto)
  extracted!: ExtractedDetailsDto;
}
