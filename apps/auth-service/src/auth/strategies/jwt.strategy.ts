import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RpcException } from '@nestjs/microservices';
import Redis from 'ioredis';
import { Inject } from '@nestjs/common';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: any) => req?.token || req?.accessToken || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'jwt-secret',
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload): Promise<JwtPayload> {
    const token = req?.token || req?.accessToken;

    if (token) {
      const isBlacklisted = await this.redis.get(`bl:${token}`);
      if (isBlacklisted) {
        throw new RpcException({
          statusCode: 401,
          message: 'Token has been revoked',
        });
      }
    }

    return { id: payload.id, email: payload.email, role: payload.role };
  }
}
