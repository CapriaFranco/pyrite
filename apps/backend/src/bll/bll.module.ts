import { Global, Module } from '@nestjs/common';
import { DalModule } from '../dal/dal.module';
import { SettingsService } from './settings/settings.service';
import { FinancesService } from './finances/finances.service';
import { RatesService } from './rates/rates.service';
import { ApiKeysService } from './apis/api-keys.service';
import { GroupsService } from './groups/groups.service';
import { NotesService } from './notes/notes.service';
import { CountsService } from './counts/counts.service';
import { CountsAuditsService } from './counts/counts-audits.service';
import { CountsRemindersService } from './counts/counts-reminders.service';
import { TasksService } from './tasks/tasks.service';
import { CalendarService } from './calendar/calendar.service';
import { LogsService } from './logs/logs.service';
import { LogViewerService } from './logs/log-viewer.service';
import { DisputesService } from './disputes/disputes.service';
import { DisputePassService } from './disputes/dispute-pass.service';
import { DisputesIntakeService } from './disputes/disputes-intake.service';
import { DisputeResolutionsService } from './disputes/dispute-resolutions.service';
import { DisputeEngineSettingsService } from './disputes/dispute-engine-settings.service';
import { RotationService } from './rotation/rotation.service';
import { SectionWriteGuard } from './rotation/section-write-guard';
import { SetupService } from './setup/setup.service';

/**
 * Domain logic layer. Feature BLL modules are registered here as they are
 * built; it must never import from gateway/ or integrations/.
 */
@Global()
@Module({
  imports: [DalModule],
  providers: [SettingsService, FinancesService, RatesService, ApiKeysService, GroupsService, NotesService, CountsService, CountsAuditsService, CountsRemindersService, TasksService, CalendarService, DisputePassService, DisputesService, DisputesIntakeService, DisputeResolutionsService, DisputeEngineSettingsService, LogsService, LogViewerService, RotationService, SectionWriteGuard, SetupService],
  exports: [SettingsService, FinancesService, RatesService, ApiKeysService, GroupsService, NotesService, CountsService, CountsAuditsService, CountsRemindersService, TasksService, CalendarService, DisputePassService, DisputesService, DisputesIntakeService, DisputeResolutionsService, DisputeEngineSettingsService, LogsService, LogViewerService, RotationService, SectionWriteGuard, SetupService],
})
export class BllModule {}
