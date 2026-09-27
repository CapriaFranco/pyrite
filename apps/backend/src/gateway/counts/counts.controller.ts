import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CountsService } from '../../bll/counts/counts.service';
import { CountsAuditsService, type CountsDuplicateGroup } from '../../bll/counts/counts-audits.service';
import {
  CountsRemindersService,
  type CredentialReminder,
  type StaleDaysSetting,
} from '../../bll/counts/counts-reminders.service';
import { type CountsAccountView } from '../../bll/counts/counts-view';
import { isCredentialType, type CountsAccountInput } from '../../bll/counts/counts-input';
import { isUuid } from '../../types/guards';
import { type SecretField } from '../../bll/counts/counts-fields';
import type { CountsListFilters } from '../../dal/counts/counts.repository';
import type { GroupRow } from '../../dal/groups/groups.repository';

/**
 * Counts gateway (spec 012). Metadata routes are declared before the `:id` ones so
 * `/counts/groups` and `/counts/audit/*` never fall into the id parameter.
 */
@Controller('counts')
export class CountsController {
  constructor(
    private readonly counts: CountsService,
    private readonly audits: CountsAuditsService,
    private readonly reminders: CountsRemindersService,
  ) {}

  // ============ AUDITS ============

  @Get('audit/weak')
  weakAudit(): Promise<{ threshold: number; accounts: CountsAccountView[] }> {
    return this.audits.weakAudit();
  }

  @Get('audit/duplicates')
  duplicatesAudit(): Promise<CountsDuplicateGroup[]> {
    return this.audits.duplicatesAudit();
  }

  // ============ REMINDERS (spec 028) ============

  /** The vault never has to be unlocked to answer this: it reads metadata only. */
  @Get('stale')
  stale(): Promise<CredentialReminder> {
    return this.reminders.reminder();
  }

  @Get('stale/settings')
  staleSettings(): StaleDaysSetting {
    return this.reminders.settingsView();
  }

  /** `staleDays: 0` turns the reminder off; anything out of range is a 400. */
  @Put('stale/settings')
  updateStaleSettings(@Body() body: { staleDays?: unknown } | undefined): Promise<StaleDaysSetting> {
    return this.reminders.updateSettings(body);
  }

  // ============ GROUPS (domain 'counts') ============

  @Get('groups')
  listGroups(): Promise<GroupRow[]> {
    return this.counts.listGroups();
  }

  @Post('groups')
  createGroup(@Body() body: { name: string }): Promise<GroupRow> {
    return this.counts.createGroup(body.name);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id') id: string): Promise<void> {
    return this.counts.removeGroup(this.uuid(id));
  }

  // ============ ACCOUNTS ============

  @Get()
  list(
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('credentialType') credentialType?: string,
    @Query('groupId') groupId?: string,
  ): Promise<CountsAccountView[]> {
    const filters: CountsListFilters = {};
    if (q) filters.q = q;
    if (kind) filters.kind = kind;
    if (credentialType) {
      if (!isCredentialType(credentialType)) throw new BadRequestException('invalid credential type');
      filters.credentialType = credentialType;
    }
    if (groupId) filters.groupId = this.uuid(groupId);
    return this.counts.list(filters);
  }

  @Post()
  create(@Body() body: CountsAccountInput): Promise<CountsAccountView> {
    return this.counts.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<CountsAccountView> {
    return this.counts.get(this.uuid(id));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: CountsAccountInput): Promise<CountsAccountView> {
    return this.counts.update(this.uuid(id), body);
  }

  @Put(':id/groups')
  setGroups(@Param('id') id: string, @Body() body: { groupIds?: string[] }): Promise<CountsAccountView> {
    if (!Array.isArray(body.groupIds)) throw new BadRequestException('groupIds must be an array');
    return this.counts.setGroups(this.uuid(id), body.groupIds);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.counts.remove(this.uuid(id));
  }

  @Get(':id/reveal')
  reveal(
    @Param('id') id: string,
    @Query('field') field?: string,
  ): Promise<Partial<Record<SecretField, string>>> {
    return this.counts.reveal(this.uuid(id), field);
  }

  @Get(':id/history')
  history(@Param('id') id: string): Promise<Array<{ id: string; password: string; changedAt: Date }>> {
    return this.counts.history(this.uuid(id));
  }

  /** Guard applied before any id reaches SQL. */
  private uuid(value: string): string {
    if (!isUuid(value)) throw new BadRequestException('invalid id');
    return value;
  }
}