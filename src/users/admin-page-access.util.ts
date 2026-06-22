export type UserBranchAccessRow = {
  branch_id: number;
  page_access?: unknown;
  branch?: { id: number; name: string; slug: string };
};

export type BranchAssignmentInput = { branch_id: number; page_access: string[] };

/** Effective admin page paths for the active branch (null = full access for SUPER_ADMIN). */
export function resolveAdminPageAccess(
  roleName: string,
  userPageAccess: unknown,
  userBranches: UserBranchAccessRow[],
  branchId: number | null,
): string[] | null {
  if (roleName === 'SUPER_ADMIN') return null;
  if (roleName !== 'ADMIN') return null;

  if (branchId != null) {
    const row = userBranches.find((b) => b.branch_id === branchId);
    if (row?.page_access && Array.isArray(row.page_access) && row.page_access.length > 0) {
      return row.page_access as string[];
    }
  }

  if (userPageAccess && Array.isArray(userPageAccess) && userPageAccess.length > 0) {
    return userPageAccess as string[];
  }

  return [];
}

export function mapBranchAssignments(userBranches: UserBranchAccessRow[]): BranchAssignmentInput[] {
  return userBranches.map((ub) => ({
    branch_id: ub.branch_id,
    page_access: Array.isArray(ub.page_access) ? (ub.page_access as string[]) : [],
  }));
}

/** Normalize Prisma userBranches rows for access helpers (works before/after page_access migration). */
export function asUserBranchAccessRows(
  rows: Array<{ branch_id: number; page_access?: unknown; branch?: { id: number; name: string; slug: string } }>,
): UserBranchAccessRow[] {
  return rows.map((row) => ({
    branch_id: row.branch_id,
    page_access: row.page_access,
    branch: row.branch,
  }));
}
