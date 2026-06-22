import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { BranchScope } from '../branch-scope';

export const CurrentBranch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest();
    if (request.allBranches) {
      throw new BadRequestException('Select a specific branch for this action');
    }
    return request.branchId as number;
  },
);

export const BranchScopeParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BranchScope => {
    const request = ctx.switchToHttp().getRequest();
    return {
      branchId: request.allBranches ? null : (request.branchId as number),
      allBranches: Boolean(request.allBranches),
    };
  },
);
