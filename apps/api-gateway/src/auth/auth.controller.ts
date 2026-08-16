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
import { AUTH_SERVICE, AUTH_MESSAGES, CurrentUser } from '@app/common';
import type { JwtPayload } from '@app/common';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '@app/common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authClient: ClientProxy) {}

  @Public()
  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.REGISTER, registerDto),
    );
  }

  @Public()
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return firstValueFrom(this.authClient.send(AUTH_MESSAGES.LOGIN, loginDto));
  }

  @Public()
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
    const accessToken = this.extractBearerToken(authorization);
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.LOGOUT, { accessToken }),
    );
  }

  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return firstValueFrom<Record<string, unknown>>(
      this.authClient.send(AUTH_MESSAGES.ME, { userId: user.id }),
    );
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return firstValueFrom(
      this.authClient.send(AUTH_MESSAGES.FORGOT_PASSWORD, forgotPasswordDto),
    );
  }

  @Public()
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
