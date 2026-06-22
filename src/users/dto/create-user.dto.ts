import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  IsInt,
  IsArray,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdminBranchAssignmentDto } from './admin-branch-assignment.dto';

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

  @ApiPropertyOptional({
    description: 'POS switch PIN (4–6 digits only). Separate from login password; used for “Switch user” on POS.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'POS PIN must be 4–6 digits' })
  pin?: string;

  @ApiProperty({ description: 'Role ID (1=SUPER_ADMIN, 2=ADMIN, 3=CASHIER)' })
  @IsInt()
  role_id: number;

  @ApiPropertyOptional({ description: 'Home branch for CASHIER role' })
  @IsOptional()
  @IsInt()
  branch_id?: number;

  @ApiPropertyOptional({ type: [Number], description: 'Deprecated — use branch_assignments' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  branch_ids?: number[];

  @ApiPropertyOptional({
    type: [AdminBranchAssignmentDto],
    description: 'Branches and page permissions for ADMIN role',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminBranchAssignmentDto)
  branch_assignments?: AdminBranchAssignmentDto[];

  @ApiPropertyOptional({
    description: 'Deprecated — use branch_assignments[].page_access per branch',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  page_access?: string[];
}
