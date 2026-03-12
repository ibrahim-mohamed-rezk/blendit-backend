import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsInt, IsArray } from 'class-validator';

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ description: 'Role ID (1=SUPER_ADMIN, 2=ADMIN, 3=CASHIER)' })
  @IsInt()
  role_id: number;

  @ApiPropertyOptional({ description: 'Allowed admin page paths for ADMIN role, e.g. ["/admin/orders", "/admin/products"]' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  page_access?: string[];
}
