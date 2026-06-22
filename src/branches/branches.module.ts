import { Global, Module } from '@nestjs/common';
import { BranchService } from './branch.service';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Global()
@Module({
  controllers: [BranchesController],
  providers: [BranchService, BranchesService],
  exports: [BranchService, BranchesService],
})
export class BranchesModule {}
