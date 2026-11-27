import { ApiProperty } from '@nestjs/swagger';
import { ClassifyPendingSummary } from '../classification.service';

export class ClassifyPendingResponseDto implements ClassifyPendingSummary {
  @ApiProperty({ description: 'Pending emails found' })
  found!: number;

  @ApiProperty({ description: 'Emails classified successfully' })
  classified!: number;

  @ApiProperty({ description: 'Emails whose AI output was invalid' })
  failed!: number;
}
