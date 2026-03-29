import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyPhoneOtpDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: '1111' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'Code must be digits only' })
  code: string;

  @ApiPropertyOptional({ description: 'Required when the phone is not yet registered (join club).' })
  @IsOptional()
  @IsString()
  name?: string;
}
