import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { AUTH_MESSAGES } from '@app/common';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_MESSAGES.REGISTER)
  register(@Payload() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @MessagePattern(AUTH_MESSAGES.LOGIN)
  login(@Payload() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @MessagePattern(AUTH_MESSAGES.REFRESH)
  refresh(@Payload() data: { refreshToken: string }) {
    return this.authService.refresh(data.refreshToken);
  }

  @MessagePattern(AUTH_MESSAGES.LOGOUT)
  logout(@Payload() data: { accessToken: string }) {
    return this.authService.logout(data.accessToken);
  }

  @MessagePattern(AUTH_MESSAGES.ME)
  me(@Payload() data: { userId: string }) {
    return this.authService.me(data.userId);
  }

  @MessagePattern(AUTH_MESSAGES.FORGOT_PASSWORD)
  forgotPassword(@Payload() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @MessagePattern(AUTH_MESSAGES.RESET_PASSWORD)
  resetPassword(@Payload() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @MessagePattern(AUTH_MESSAGES.VALIDATE_TOKEN)
  validateToken(@Payload() data: { token: string }) {
    return this.authService.validateToken(data.token);
  }
}
