import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendPhoneOtpDto {
  @ApiProperty({ example: '01012345678' })
  @IsString()
  @IsNotEmpty()
  phone: string;
}
