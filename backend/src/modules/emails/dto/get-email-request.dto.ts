import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class GetEmailRequestDto {
  @ApiProperty({ example: 'a1b2c3d4-0000-0000-0000-000000000000' })
  @IsUUID()
  id!: string;
}
