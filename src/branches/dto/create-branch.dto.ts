import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  delivery_address_prefix?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
