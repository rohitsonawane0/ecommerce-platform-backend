import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { AUTH_SERVICE, AUTH_MESSAGES } from '@app/common';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authClient: ClientProxy) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.REGISTER, registerDto),
    );
  }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return firstValueFrom(this.authClient.send(AUTH_MESSAGES.LOGIN, loginDto));
  }

  @Post('refresh')
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.REFRESH, {
        refreshToken: refreshTokenDto.refreshToken,
      }),
    );
  }

  @Post('logout')
  logout(@Headers('authorization') authorization: string) {
    const token = this.extractBearerToken(authorization);
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.LOGOUT, { accessToken: token }),
    );
  }

  @Get('me')
  async me(@Headers('authorization') authorization: string) {
    const token = this.extractBearerToken(authorization);
    const user: { id: string; email: string; role: string } =
      await firstValueFrom(
        this.authClient.send(AUTH_MESSAGES.VALIDATE_TOKEN, { token }),
      );
    return firstValueFrom<Record<string, unknown>>(
      this.authClient.send(AUTH_MESSAGES.ME, { userId: user.id }),
    );
  }

  @Post('forgot-password')
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.FORGOT_PASSWORD, forgotPasswordDto),
    );
  }

  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.RESET_PASSWORD, resetPasswordDto),
    );
  }

  private extractBearerToken(authorization: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }
    return authorization.slice(7);
  }
}
