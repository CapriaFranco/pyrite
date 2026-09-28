import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { SetupController } from './setup/setup.controller';
import { SettingsController } from './settings/settings.controller';
import { FinancesController } from './finances/finances.controller';
import { RatesController } from './rates/rates.controller';
import { ApiKeysController } from './apis/api-keys.controller';
import { NotesController } from './notes/notes.controller';
import { CountsController } from './counts/counts.controller';
import { TasksController } from './tasks/tasks.controller';
import { CalendarController } from './calendar/calendar.controller';
import { LogsController } from './logs/logs.controller';
import { DisputesController } from './disputes/disputes.controller';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from '../services/services.module';
import { BllModule } from '../bll/bll.module';

@Module({
  imports: [ServicesModule, BllModule, AuthModule],
  controllers: [HealthController, SettingsController, FinancesController, RatesController, ApiKeysController, NotesController, CountsController, TasksController, CalendarController, DisputesController, LogsController, SetupController],
})
export class GatewayModule {}
