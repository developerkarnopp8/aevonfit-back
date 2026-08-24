import { Controller, Post, UseGuards, Request, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns JWT access token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Request() req, @Body() _loginDto: LoginDto) {
    return this.authService.login(req.user);
  }
}
