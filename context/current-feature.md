# Current Feature: Auth Service

## Status

In Progress

## Goals

- Create User entity with TypeORM (UUID, email, password, role, reset token fields)
- Implement Register flow (validation, bcrypt hashing, JWT token generation)
- Implement Login flow using LocalStrategy (email + password validation)
- Implement Refresh Token flow with JWT rotation and Redis blacklisting
- Implement Logout with Redis token blacklisting (TTL-based)
- Implement Get Profile (me) endpoint
- Implement Forgot Password (generate hashed reset token, 1-hour expiry)
- Implement Reset Password (validate token, update password)
- Implement Token Validation for gateway JWT guard
- Set up Passport strategies (Local, JWT, JWT-Refresh) as injectable services (not HTTP guards)
- Configure AuthModule with PassportModule, JwtModule, TypeORM, and Redis providers
- Wire up MessagePattern handlers in auth controller
- Add all message pattern constants to @app/common

## Notes

- TCP microservice on port 3001, database `auth_db` on port 5433
- Passport strategies are invoked programmatically (not via HTTP guards) since this is a TCP service
- Access token TTL: 15 min, Refresh token TTL: 7 days
- Forgot password should not leak user existence (always return success)
- Reset token: `crypto.randomBytes`, hashed before storage, 1-hour expiry
- Dependencies needed: @nestjs/passport, passport, passport-local, passport-jwt, @nestjs/jwt, bcrypt, ioredis, class-validator, class-transformer (plus @types packages)
- Role enum (user/admin) defined in @app/common

## History

<!-- Keep this updated. Earliest to latest -->
