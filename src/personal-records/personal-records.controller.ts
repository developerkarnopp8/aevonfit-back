import { Controller, Post, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PersonalRecordsService } from './personal-records.service';
import { CreatePersonalRecordDto } from './dto/create-personal-record.dto';

@ApiTags('personal-records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('personal-records')
export class PersonalRecordsController {
  constructor(private readonly service: PersonalRecordsService) {}

  @Roles('athlete')
  @Post()
  @ApiOperation({ summary: 'Registra uma tentativa de PR (carga e/ou reps)' })
  create(@Body() dto: CreatePersonalRecordDto, @Request() req: any) {
    return this.service.create(req.user.id, dto);
  }
}
