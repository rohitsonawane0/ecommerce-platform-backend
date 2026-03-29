# Auth Service

**Type:** TCP Microservice (port 3001)
**Database:** Postgres `auth_db` on port 5433
**Status:** Existing scaffold -- needs full implementation

## Entities

### User

| Field              | Type      | Notes                            |
|--------------------|-----------|----------------------------------|
| id                 | UUID      | Primary key, auto-generated      |
| email              | string    | Unique, indexed                  |
| password           | string    | Bcrypt hashed                    |
| firstName          | string    |                                  |
| lastName           | string    |                                  |
| role               | enum      | `user` / `admin`, default `user` |
| isEmailVerified    | boolean   | Default `false`                  |
| resetPasswordToken | string    | Nullable, hashed random token    |
| resetPasswordExpiry| timestamp | Nullable                         |
| createdAt          | timestamp | Auto-generated                   |
| updatedAt          | timestamp | Auto-updated                     |

## Passport Strategy Architecture

Auth-service uses Passport strategies internally for credential validation and token handling. Since this is a TCP microservice (not HTTP), strategies are invoked programmatically by the auth service -- not via HTTP guards.

### Strategies

#### LocalStrategy (`passport-local`)
- **Used by:** Login flow
- **Validates:** email + password
- Looks up user by email, compares bcrypt hash
- Returns user object on success, throws `RpcException` on failure
- Invoked programmatically in `AuthService.login()` (no HTTP request context in TCP)

#### JwtStrategy (`passport-jwt`)
- **Used by:** Token validation (`auth.validateToken`), Get Profile (`auth.me`), Logout
- **Extracts:** token from the payload sent by the gateway
- **Validates:** token signature, expiry, checks Redis blacklist
- Returns user payload `{ id, email, role }` on success

#### JwtRefreshStrategy (`passport-jwt`)
- **Used by:** Refresh token flow
- **Separate secret:** `JWT_REFRESH_SECRET` (different from access token secret)
- **Validates:** refresh token signature, expiry, checks Redis blacklist
- Returns user payload for re-issuing tokens

### How Passport Works in a TCP Microservice

Since Passport guards (`@UseGuards(AuthGuard('local'))`) depend on HTTP `req/res`, they cannot be used directly in a TCP `@MessagePattern` handler. Instead:

1. **Gateway** receives the HTTP request and forwards data via TCP
2. **Auth-service** receives the TCP message payload
3. **Auth-service** calls the strategy's `validate()` method directly via the service layer (not through Passport guards)
4. Strategies are registered as providers but used as injectable services for their validation logic

## Features

### Register
- Validate input (email format, password strength via class-validator)
- Check email uniqueness
- Hash password with bcrypt (salt rounds: 10)
- Create user record
- Generate access + refresh JWT tokens via `@nestjs/jwt`
- Return user profile (without password) + tokens

### Login
- Receive email + password from gateway
- Use LocalStrategy validation logic: find user by email, compare bcrypt hash
- On success: generate access token (15min) + refresh token (7d)
- Return user profile + tokens

### Refresh Token
- Receive refresh token from gateway
- Use JwtRefreshStrategy validation: verify signature with `JWT_REFRESH_SECRET`, check Redis blacklist
- Blacklist the old refresh token in Redis
- Issue new access + refresh token pair (rotation)
- Return new tokens

### Logout
- Receive access token from gateway (forwarded from Authorization header)
- Decode token to get expiry
- Add token to Redis blacklist with TTL = remaining time until expiry
- Return success confirmation

### Get Profile (me)
- Receive user ID (extracted from token by gateway's JWT guard)
- Query user by ID
- Return user profile (exclude password, resetPasswordToken)

### Forgot Password
- Receive email
- Look up user (if not found, still return success -- don't leak existence)
- Generate random reset token (`crypto.randomBytes`), hash it, store on user with 1-hour expiry
- Stub: `console.log` the reset link (no real email)
- Return generic success message

### Reset Password
- Receive reset token + new password
- Hash the incoming token, find user with matching `resetPasswordToken` and non-expired `resetPasswordExpiry`
- Hash new password with bcrypt
- Update user, clear reset token fields
- Return success

### Token Validation (for gateway JWT guard)
- Receive access token from gateway
- Use JwtStrategy validation: verify signature, check expiry, check Redis blacklist
- Return user payload `{ id, email, role }` or throw `RpcException`

### Role-Based Access
- `UserRole` enum: `user`, `admin` (defined in `@app/common`)
- Role stored on User entity, included in JWT payload
- Gateway reads role from validated token for route-level `@Roles()` checks

## Files to Create/Modify

- `apps/auth-service/src/auth/entities/user.entity.ts` -- TypeORM entity
- `apps/auth-service/src/auth/dto/register.dto.ts`
- `apps/auth-service/src/auth/dto/login.dto.ts`
- `apps/auth-service/src/auth/dto/forgot-password.dto.ts`
- `apps/auth-service/src/auth/dto/reset-password.dto.ts`
- `apps/auth-service/src/auth/strategies/local.strategy.ts` -- passport-local, validates email+password
- `apps/auth-service/src/auth/strategies/jwt.strategy.ts` -- passport-jwt, validates access tokens
- `apps/auth-service/src/auth/strategies/jwt-refresh.strategy.ts` -- passport-jwt, validates refresh tokens
- `apps/auth-service/src/auth/auth.service.ts` -- full business logic, uses strategies' validate methods
- `apps/auth-service/src/auth/auth.controller.ts` -- MessagePattern handlers
- `apps/auth-service/src/auth/auth.module.ts` -- PassportModule, JwtModule, TypeORM, Redis providers
- `apps/auth-service/src/auth-service.module.ts` -- ConfigModule, TypeORM root config

## Message Patterns

```
AUTH_MESSAGES.REGISTER        = 'auth.register'
AUTH_MESSAGES.LOGIN           = 'auth.login'
AUTH_MESSAGES.REFRESH         = 'auth.refresh'
AUTH_MESSAGES.LOGOUT          = 'auth.logout'
AUTH_MESSAGES.ME              = 'auth.me'
AUTH_MESSAGES.FORGOT_PASSWORD = 'auth.forgotPassword'
AUTH_MESSAGES.RESET_PASSWORD  = 'auth.resetPassword'
AUTH_MESSAGES.VALIDATE_TOKEN  = 'auth.validateToken'
```

## Dependencies

- `@nestjs/passport` -- Passport integration for NestJS
- `passport` -- core Passport library
- `passport-local` / `@types/passport-local` -- local strategy (email+password)
- `passport-jwt` / `@types/passport-jwt` -- JWT strategy
- `@nestjs/jwt` -- JWT token generation/validation
- `bcrypt` / `@types/bcrypt` -- password hashing
- `ioredis` / `@nestjs-modules/ioredis` -- Redis for token blacklist
- `typeorm` / `pg` -- Postgres
- `class-validator` / `class-transformer` -- DTO validation
