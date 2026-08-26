import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StudentsModule } from './students/students.module';
import { TrainingPlansModule } from './training-plans/training-plans.module';
import { SessionsModule } from './sessions/sessions.module';
import { WorkoutLogsModule } from './workout-logs/workout-logs.module';
import { ExerciseLibraryModule } from './exercise-library/exercise-library.module';
import { PaymentsModule } from './payments/payments.module';
import { MessagesModule } from './messages/messages.module';
import { WorkoutSkipsModule } from './workout-skips/workout-skips.module';
import { DailyIntakeModule } from './daily-intake/daily-intake.module';
import { MovementsModule } from './movements/movements.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 30,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    StudentsModule,
    TrainingPlansModule,
    SessionsModule,
    WorkoutLogsModule,
    ExerciseLibraryModule,
    PaymentsModule,
    MessagesModule,
    WorkoutSkipsModule,
    DailyIntakeModule,
    MovementsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
