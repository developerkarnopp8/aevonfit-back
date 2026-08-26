import { Module } from '@nestjs/common';
import { DailyIntakeService } from './daily-intake.service';
import { DailyIntakeController } from './daily-intake.controller';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [StudentsModule],
  controllers: [DailyIntakeController],
  providers: [DailyIntakeService],
  exports: [DailyIntakeService],
})
export class DailyIntakeModule {}
