import { Module } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { WorkoutSkipsController } from './workout-skips.controller';
import { StudentsModule } from '../students/students.module';
import { MessagesModule } from '../messages/messages.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [StudentsModule, MessagesModule, NotificationsModule],
  controllers: [WorkoutSkipsController],
  providers: [WorkoutSkipsService],
  exports: [WorkoutSkipsService],
})
export class WorkoutSkipsModule {}
