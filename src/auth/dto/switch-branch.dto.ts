import { IsInt } from 'class-validator';

export class SwitchBranchDto {
  @IsInt()
  branch_id: number;
}
