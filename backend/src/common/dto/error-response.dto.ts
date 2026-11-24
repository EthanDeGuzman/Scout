import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-code.enum';

export class ErrorBodyDto {
  @ApiProperty({ enum: ErrorCode, example: ErrorCode.NOT_FOUND })
  code!: ErrorCode;

  @ApiProperty({ example: 'Email not found' })
  message!: string;

  @ApiProperty({
    nullable: true,
    type: [String],
    example: null,
    description: 'Extra info, e.g. the list of validation failures. Else null.',
  })
  details!: string[] | null;
}

export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
