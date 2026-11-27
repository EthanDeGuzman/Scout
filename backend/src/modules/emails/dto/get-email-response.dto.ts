import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmailListItemDto } from './list-emails-response.dto';

export class GetEmailResponseDto extends EmailListItemDto {
  @ApiPropertyOptional({ nullable: true, type: String }) toAddresses!:
    string | null;
  @ApiProperty() bodyText!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) reason!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Object })
  extracted!: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true, type: String }) lastError!:
    string | null;
}
