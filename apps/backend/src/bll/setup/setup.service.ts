import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

/** Settings key of the first-run flag. A missing value means the app was never set up. */
export const FIRST_RUN_KEY = 'setup.first_run';

export interface SetupStatus {
  firstRun: boolean;
}

/**
 * Whether the app still has to be configured before it is usable (spec 031).
 *
 * One flag in the settings table, read through the service that already caches it:
 * no new table, no column and no query of its own, so "this is the first run" has
 * exactly one source of truth. The frontend asks this and nothing else.
 */
@Injectable()
export class SetupService {
  constructor(private readonly settings: SettingsService) {}

  /** `true` while the flag is absent or not a `false`: the default is "first run". */
  status(): SetupStatus {
    return { firstRun: this.settings.get(FIRST_RUN_KEY) !== false };
  }

  /** The onboarding calls this when it finishes, so it does not come back. */
  async complete(): Promise<SetupStatus> {
    await this.settings.set(FIRST_RUN_KEY, false);
    return { firstRun: false };
  }
}
