export type BranchScope = {
  branchId: number | null;
  allBranches: boolean;
};

export function orderBranchWhere(scope: BranchScope): { branch_id?: number } {
  if (scope.allBranches || scope.branchId == null) return {};
  return { branch_id: scope.branchId };
}
