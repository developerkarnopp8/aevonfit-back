import { Module } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { WorkoutSkipsController } from './workout-skips.controller';
import { StudentsModule } from '../students/students.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [StudentsModule, MessagesModule],
  controllers: [WorkoutSkipsController],
  providers: [WorkoutSkipsService],
  exports: [WorkoutSkipsService],
})
export class WorkoutSkipsModule {}
