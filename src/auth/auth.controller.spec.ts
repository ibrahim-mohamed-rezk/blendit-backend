import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { BranchService } from '../branches/branch.service';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: ActivityLogsService, useValue: {} },
        // Required because route guards (BranchGuard) are instantiated during compile.
        { provide: BranchService, useValue: {} },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
