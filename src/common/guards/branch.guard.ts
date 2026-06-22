import { CanActivate, ExecutionContext, BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BranchService } from '../../branches/branch.service';

/** Super-admin employee endpoints are org-wide, not tied to one branch header. */
function isSuperAdminUsersWrite(request: {
  method?: string;
  url?: string;
  path?: string;
  baseUrl?: string;
  route?: { path?: string };
}): boolean {
  const method = String(request.method ?? 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const haystack = [request.baseUrl, request.url, request.path, request.route?.path].filter(Boolean).join(' ');
  return /\/users(\/|$|\?)/.test(haystack);
}

@Injectable()
export class BranchGuard implements CanActivate {
  constructor(private branchService: BranchService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;

    const allRaw = request.headers['x-branch-all'];
    const allHeader =
      allRaw === 'true' ||
      allRaw === '1' ||
      (Array.isArray(allRaw) && (allRaw[0] === 'true' || allRaw[0] === '1'));

    if (allHeader) {
      if (user.role?.name !== 'SUPER_ADMIN') {
        throw new ForbiddenException('Only super admins can view all branches');
      }
      const method = String(request.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !isSuperAdminUsersWrite(request)) {
        throw new BadRequestException('Select a specific branch to modify data');
      }
      request.allBranches = true;
      request.branchId = null;
      return true;
    }

    const headerRaw = request.headers['x-branch-id'];
    const headerBranchId =
      headerRaw != null && headerRaw !== ''
        ? Number(Array.isArray(headerRaw) ? headerRaw[0] : headerRaw)
        : undefined;

    const jwtBranchId =
      request.user?.jwtBranchId != null ? Number(request.user.jwtBranchId) : undefined;

    const branchId = await this.branchService.resolveActiveBranchId(
      user,
      Number.isFinite(headerBranchId) ? headerBranchId : undefined,
      Number.isFinite(jwtBranchId) ? jwtBranchId : undefined,
    );

    request.allBranches = false;
    request.branchId = branchId;
    return true;
  }
}
