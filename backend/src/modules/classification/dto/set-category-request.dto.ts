import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { EmailCategory } from '../../emails/email-category.enum';

export class SetCategoryRequestDto {
  @ApiProperty({ enum: EmailCategory })
  @IsEnum(EmailCategory)
  category!: EmailCategory;
}
