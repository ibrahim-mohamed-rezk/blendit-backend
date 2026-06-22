import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminBranchAssignmentDto } from './admin-branch-assignment.dto';

export class SetUserBranchesDto {
  @ApiProperty({
    type: [AdminBranchAssignmentDto],
    description: 'Branch access with per-branch page permissions',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AdminBranchAssignmentDto)
  branch_assignments: AdminBranchAssignmentDto[];
}
