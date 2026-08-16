import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { User } from './entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from '@app/common';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async register(registerDto: RegisterDto) {
    const existing = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existing) {
      throw new RpcException({
        statusCode: 409,
        message: 'Email already exists',
      });
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = this.userRepository.create({
      ...registerDto,
      password: hashedPassword,
    });

    const savedUser = await this.userRepository.save(user);
    const tokens = await this.generateTokens(savedUser);

    return {
      user: this.sanitizeUser(savedUser),
      ...tokens,
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateCredentials(
      loginDto.email,
      loginDto.password,
    );
    const tokens = await this.generateTokens(user);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'jwt-refresh-secret',
      });
    } catch {
      throw new RpcException({
        statusCode: 401,
        message: 'Invalid or expired refresh token',
      });
    }

    const isBlacklisted = await this.redis.get(`bl:${refreshToken}`);
    if (isBlacklisted) {
      throw new RpcException({
        statusCode: 401,
        message: 'Refresh token has been revoked',
      });
    }

    await this.blacklistToken(refreshToken);

    const user = await this.userRepository.findOne({
      where: { id: payload.id },
    });
    if (!user) {
      throw new RpcException({ statusCode: 401, message: 'User not found' });
    }

    return this.generateTokens(user);
  }

  async logout(accessToken: string) {
    await this.blacklistToken(accessToken);
    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new RpcException({ statusCode: 404, message: 'User not found' });
    }

    return this.sanitizeUser(user);
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { email: forgotPasswordDto.email },
    });

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await this.userRepository.save(user);

      // Stub: log the reset link instead of sending email
      console.log(`Password reset link: /reset-password?token=${resetToken}`);
    }

    // Always return success to avoid leaking user existence
    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetPasswordDto.token)
      .digest('hex');

    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.resetPasswordToken = :token', { token: hashedToken })
      .andWhere('user.resetPasswordExpiry > :now', { now: new Date() })
      .getOne();

    if (!user) {
      throw new RpcException({
        statusCode: 400,
        message: 'Invalid or expired reset token',
      });
    }

    user.password = await bcrypt.hash(resetPasswordDto.newPassword, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpiry = null;
    await this.userRepository.save(user);

    return { message: 'Password reset successfully' };
  }

  async validateToken(token: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_SECRET || 'jwt-secret',
      });
    } catch {
      throw new RpcException({
        statusCode: 401,
        message: 'Invalid or expired token',
      });
    }

    const isBlacklisted = await this.redis.get(`bl:${token}`);
    if (isBlacklisted) {
      throw new RpcException({
        statusCode: 401,
        message: 'Token has been revoked',
      });
    }

    return { id: payload.id, email: payload.email, role: payload.role };
  }

  private async validateCredentials(
    email: string,
    password: string,
  ): Promise<User> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new RpcException({
        statusCode: 401,
        message: 'Invalid credentials',
      });
    }
    return user;
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_SECRET || 'jwt-secret',
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'jwt-refresh-secret',
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async blacklistToken(token: string) {
    try {
      const decoded = this.jwtService.decode(token);
      if (decoded?.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await this.redis.set(`bl:${token}`, '1', 'EX', ttl);
        }
      }
    } catch {
      // Token already invalid, no need to blacklist
    }
  }

  private sanitizeUser(user: User) {
    const { password, resetPasswordToken, resetPasswordExpiry, ...sanitized } =
      user;
    return sanitized;
  }
}
