import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StudentsModule } from './students/students.module';
import { TrainingPlansModule } from './training-plans/training-plans.module';
import { SessionsModule } from './sessions/sessions.module';
import { WorkoutLogsModule } from './workout-logs/workout-logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    StudentsModule,
    TrainingPlansModule,
    SessionsModule,
    WorkoutLogsModule,
  ],
})
export class AppModule {}
