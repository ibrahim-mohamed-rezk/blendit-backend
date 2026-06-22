import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsInt, IsString } from 'class-validator';

export class AdminBranchAssignmentDto {
  @ApiProperty({ description: 'Branch ID this admin may access' })
  @IsInt()
  branch_id: number;

  @ApiProperty({
    type: [String],
    description: 'Allowed admin page paths for this branch, e.g. ["/admin/orders"]',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  page_access: string[];
}
