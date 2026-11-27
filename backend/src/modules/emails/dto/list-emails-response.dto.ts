import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EmailListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() subject!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) senderName!:
    string | null;
  @ApiProperty() senderAddress!: string;
  @ApiProperty() receivedAt!: Date;
  @ApiProperty() isRead!: boolean;
  @ApiProperty() processingStatus!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) category!:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: Boolean }) requiresAction!:
    boolean | null;
  @ApiPropertyOptional({ nullable: true, type: Boolean }) needsReview!:
    boolean | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) confidence!:
    number | null;
}

export class ListEmailsResponseDto {
  @ApiProperty({ type: [EmailListItemDto] }) data!: EmailListItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}
