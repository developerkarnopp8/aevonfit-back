import { Module } from '@nestjs/common';
import { ExerciseLibraryController } from './exercise-library.controller';
import { ExerciseLibraryService } from './exercise-library.service';

@Module({
  controllers: [ExerciseLibraryController],
  providers: [ExerciseLibraryService],
})
export class ExerciseLibraryModule {}
