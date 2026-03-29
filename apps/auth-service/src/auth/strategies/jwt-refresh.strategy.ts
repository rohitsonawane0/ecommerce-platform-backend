import { Injectable, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RpcException } from '@nestjs/microservices';
import Redis from 'ioredis';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: any) => req?.refreshToken || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET || 'jwt-refresh-secret',
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload): Promise<JwtPayload> {
    const token = req?.refreshToken;

    if (token) {
      const isBlacklisted = await this.redis.get(`bl:${token}`);
      if (isBlacklisted) {
        throw new RpcException({
          statusCode: 401,
          message: 'Refresh token has been revoked',
        });
      }
    }

    return { id: payload.id, email: payload.email, role: payload.role };
  }
}
