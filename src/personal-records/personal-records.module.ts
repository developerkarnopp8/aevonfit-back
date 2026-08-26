import { Module } from '@nestjs/common';
import { PersonalRecordsService } from './personal-records.service';
import { PersonalRecordsController } from './personal-records.controller';
import { StudentsModule } from '../students/students.module';
import { MovementsModule } from '../movements/movements.module';

@Module({
  imports: [StudentsModule, MovementsModule],
  controllers: [PersonalRecordsController],
  providers: [PersonalRecordsService],
  exports: [PersonalRecordsService],
})
export class PersonalRecordsModule {}
