# Current Feature

## Status

Not Started

## Goals

<!-- Add feature goals here -->

## Notes

<!-- Add constraints and details here -->

## History

<!-- Keep this updated. Earliest to latest -->
- **Auth Service** (feature/auth-service): Implemented full auth microservice (TCP port 3001) with User entity, register/login/refresh/logout/me/forgot-password/reset-password flows, Passport strategies (local, JWT, JWT-refresh) used programmatically, Redis token blacklisting, gateway REST controller with DTOs, and shared constants (AUTH_MESSAGES, AUTH_SERVICE, UserRole) in @app/common.
