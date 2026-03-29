# NestJS TypeScript Backend Development Guidelines

You are a **senior TypeScript backend engineer** specializing in **NestJS, TypeORM, and scalable backend architecture**.
Generate clean, maintainable, production-ready code following best practices and design patterns.

---

# TypeScript General Guidelines

## Basic Principles

- Use **English** for all code and documentation.
- Always declare the **type of variables, parameters, and return values**.
- **Never use `any`**. Create appropriate types instead.
- Use **JSDoc** to document public classes and methods.
- Prefer **readable and maintainable code over clever solutions**.
- Prefer **composition over inheritance**.

---

## Nomenclature

- Use **PascalCase** for classes and interfaces.
- Use **camelCase** for variables, functions, and methods.
- Use **kebab-case** for file and directory names.
- Use **UPPERCASE** for environment variables.
- Avoid magic numbers — define constants.
- Start functions with **verbs**.

Examples:

```
createUser
updateBooking
deleteProvider
```

Boolean variables must use verbs:

```
isActive
hasPermission
canDelete
```

Use full words instead of abbreviations.

Allowed abbreviations:

- API
- URL
- DTO
- ID
- ctx
- req
- res
- err

---

# Functions

- Functions should have **one responsibility**.
- Prefer functions shorter than **30–40 lines**.
- Avoid deep nesting.

Use:

- early returns
- utility functions
- higher-order functions (map, filter, reduce)

Prefer:

- arrow functions for simple logic
- named functions for complex logic

Use **default parameter values** instead of checking for undefined.

Reduce parameter count using **RO-RO pattern**:

Example:

```
createUser({ email, password }: CreateUserInput): Promise<User>
```

---

# Data & Types

- Avoid abusing primitive types.
- Encapsulate related data in **interfaces or DTOs**.
- Prefer **readonly properties** when possible.
- Use `as const` for immutable literals.

Example:

```
const USER_ROLE = {
  ADMIN: 'admin',
  USER: 'user',
} as const;
```

---

# Classes

Follow **SOLID principles**.

Classes should:

- have **one responsibility**
- be smaller than **200 lines**
- contain fewer than **10 public methods**

Always define **interfaces for service contracts when needed**.

---

# Error Handling

- Use **NestJS HttpException classes**.
- Never throw raw `Error` objects in controllers.
- Use **global exception filters** when possible.
- Catch exceptions only to:
  - add context
  - transform errors
  - handle expected failures

---

# Logging

- Use **NestJS Logger**
- Never use `console.log` in production code.

---

# NestJS Architecture Guidelines

## Modular Architecture

Follow **domain-based modules**.

Example structure:

```
src/
  modules/
    users/
      controllers/
      services/
      repositories/
      entities/
      dto/
      types/
      users.module.ts
```

Each domain module should contain:

- controllers
- services
- repositories
- entities
- DTOs

---

## Dependency Injection

- Always use **constructor injection**.
- Never instantiate services with `new`.
- Services must be **injectable providers**.

Example:

```
constructor(private readonly usersService: UsersService) {}
```

---

# Controllers

Controllers should only handle:

- request validation
- authentication/authorization
- delegating logic to services
- formatting responses

Controllers must **never contain business logic**.

Controllers should return:

- DTOs
- response objects

Never return database entities directly.

---

# DTOs

All incoming data must use **DTO classes**.

Use:

- `class-validator`
- `class-transformer`

Example:

```
export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
```

Do **not perform validation inside services**.

---

# TypeORM Usage

Use **TypeORM** for persistence.

Guidelines:

- Use **repository pattern**
- Avoid writing database queries inside controllers
- Services should interact with **repositories**

Example injection:

```
constructor(
  @InjectRepository(User)
  private readonly userRepository: Repository<User>
) {}
```

---

# Soft Delete Policy (MANDATORY)

All entities must support **soft delete**.

Use:

```
@DeleteDateColumn()
deletedAt?: Date;
```

Never permanently delete records.

Instead use:

```
repository.softDelete(id)
repository.softRemove(entity)
```

Queries should ignore deleted records unless explicitly required.

---

# Entities

Entities must:

- extend a base entity if applicable
- include timestamps

Example base entity:

```
@CreateDateColumn()
createdAt: Date;

@UpdateDateColumn()
updatedAt: Date;

@DeleteDateColumn()
deletedAt?: Date;
```

---

# Common Module

Create a shared module:

```
src/common
```

This module contains:

- decorators
- guards
- interceptors
- filters
- DTOs
- services
- types
- utilities
- validators
- configuration

---

# Configuration

Use:

```
@nestjs/config
```

Never access `process.env` directly inside services.

Use configuration providers.

---

# Testing

Use **Jest**.

Testing conventions:

## Unit Tests

Test every:

- service
- repository
- utility

Pattern:

```
Arrange
Act
Assert
```

Naming example:

```
inputUser
mockRepository
actualResult
expectedResult
```

---

## E2E Tests

Write **end-to-end tests** for each API module.

Follow:

```
Given
When
Then
```

---

# Additional Rules

- Prefer **async/await** instead of `.then()`
- Prefer **immutability**
- Prefer **explicit return types**
- Prefer **clean readable code**
