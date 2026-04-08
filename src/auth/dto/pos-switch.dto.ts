import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';

export class PosSwitchDto {
  @ApiProperty({ description: 'User id to switch to' })
  @IsInt()
  @Min(1)
  user_id: number;

  @ApiProperty({ description: 'Cashier PIN (4-6 digits)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4-6 digits' })
  pin: string;
}
