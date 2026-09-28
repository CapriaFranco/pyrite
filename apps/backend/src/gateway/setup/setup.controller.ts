import { Controller, Get, Post } from '@nestjs/common';
import { SetupService, type SetupStatus } from '../../bll/setup/setup.service';

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  /** 0/1 in one call: whether the app still has to be configured. */
  @Get()
  status(): SetupStatus {
    return this.setup.status();
  }

  /** Marks the first run as done. Called by the onboarding when it completes. */
  @Post()
  complete(): Promise<SetupStatus> {
    return this.setup.complete();
  }
}
