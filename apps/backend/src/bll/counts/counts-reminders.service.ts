import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CountsRepository } from '../../dal/counts/counts.repository';
import { SettingsService } from '../settings/settings.service';
import { toViews, type CountsAccountView } from './counts-view';
import {
  DEFAULT_STALE_DAYS,
  MAX_STALE_DAYS,
  MIN_STALE_DAYS,
  STALE_DAYS_KEY,
  ageInDays,
  isStale,
  parseStaleDays,
} from './credential-age';

/** A metadata view plus the one number this feature adds. */
export interface StaleAccountView extends CountsAccountView {
  ageDays: number;
}

export interface CredentialReminder {
  staleDays: number;
  /** True when the threshold is 0: the reminder is off and no account is listed. */
  disabled: boolean;
  /** Active accounts carrying a stored password. */
  checked: number;
  /** `stale` and `unknown` are the two disjoint subsets of `checked`; the rest is fresh. */
  stale: number;
  /** Carrying a password with no date (only reachable by writing the table outside the API). */
  unknown: number;
  /** Only the stale ones, oldest first. */
  accounts: StaleAccountView[];
}

export interface StaleDaysSetting {
  staleDays: number;
}

/**
 * Rotation reminder of the counts vault (spec 028). Read-only and metadata-only: it reads the
 * date each credential carries, decrypts nothing and needs no unlock, which is what makes it
 * usable as the first thing the vault screen asks for. It rotates nothing and notifies nobody:
 * spec 012 already decided that rotating a stored password means logging into that site, so
 * this only reports.
 */
@Injectable()
export class CountsRemindersService {
  private readonly log = new Logger(CountsRemindersService.name);

  constructor(
    private readonly repo: CountsRepository,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The reminder itself: the age of every credential carrying a password, measured against
   * the threshold. The repository query and the projection are the ones the list and the
   * audits already use, so no secret column is even selected twice for this.
   */
  async reminder(): Promise<CredentialReminder> {
    const staleDays = this.staleDays();
    const now = new Date();
    const views = await toViews(this.repo, await this.repo.findWithStoredPassword());

    let unknown = 0;
    const accounts: StaleAccountView[] = [];
    for (const view of views) {
      const ageDays = ageInDays(now, view.lastPasswordChangedAt);
      if (ageDays === null) {
        // The reminder does not invent a date: it exposes the case instead of hiding it.
        unknown += 1;
        continue;
      }
      if (isStale(ageDays, staleDays)) accounts.push({ ...view, ageDays });
    }
    accounts.sort((a, b) => b.ageDays - a.ageDays);

    const reminder: CredentialReminder = {
      staleDays,
      disabled: staleDays === MIN_STALE_DAYS,
      checked: views.length,
      stale: accounts.length,
      unknown,
      accounts,
    };
    // Nothing read here is secret, so the line needs no redaction.
    this.log.log('recordatorio de rotacion de credenciales', {
      staleDays,
      checked: reminder.checked,
      stale: reminder.stale,
      unknown: reminder.unknown,
    });
    return reminder;
  }

  /** Effective threshold. The setting is the single source: no per-call override. */
  settingsView(): StaleDaysSetting {
    return { staleDays: this.staleDays() };
  }

  /** Only an integer inside the range is stored; `0` is the documented way to turn it off. */
  async updateSettings(body: { staleDays?: unknown } | undefined): Promise<StaleDaysSetting> {
    const staleDays = parseStaleDays(body?.staleDays);
    if (staleDays === null) {
      throw new BadRequestException(
        `staleDays must be an integer between ${MIN_STALE_DAYS} and ${MAX_STALE_DAYS}`,
      );
    }
    await this.settings.set(STALE_DAYS_KEY, staleDays);
    this.log.log('umbral de rotacion actualizado', { staleDays });
    return { staleDays };
  }

  /** A nonsense value stored through the generic `PUT /settings/:key` falls back to 90. */
  private staleDays(): number {
    return parseStaleDays(this.settings.get(STALE_DAYS_KEY)) ?? DEFAULT_STALE_DAYS;
  }
}
