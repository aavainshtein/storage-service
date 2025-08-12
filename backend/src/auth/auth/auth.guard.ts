// src/auth/auth.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';

// Расширяем интерфейс Request для добавления полей пользователя Hasura
declare module 'express' {
  interface Request {
    hasuraUserId?: string;
    hasuraRoles?: string[];
    isAuthenticated?: boolean;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private jwksClient: jwksClient.JwksClient;
  private hasuraJwtSecret: string;
  private betterAuthApiUrl: string;

  constructor(private configService: ConfigService) {
    this.hasuraJwtSecret = this.configService.get<string>(
      'HASURA_GRAPHQL_JWT_SECRET',
    )!;
    this.betterAuthApiUrl = this.configService.get<string>(
      'BETTER_AUTH_API_URL',
    )!;

    if (!this.hasuraJwtSecret) {
      this.logger.error(
        'HASURA_GRAPHQL_JWT_SECRET is not defined in environment variables.',
      );
      // В продакшене лучше сразу бросать исключение
    }

    if (!this.betterAuthApiUrl) {
      this.logger.warn(
        'BETTER_AUTH_API_URL is not defined. Cookie authentication will be skipped or mocked.',
      );
    }

    // Инициализируем jwksClient, если JWT-секрет является JWKS-URL
    // В нашем случае, HASURA_GRAPHQL_JWT_SECRET будет простой строкой, поэтому jwksClient не нужен для валидации
    // Если бы Hasura использовала JWKS, то инициализация была бы такой:
    // this.jwksClient = jwksClient({
    //   jwksUri: this.hasuraJwtSecret // Если секрет это URL JWKS
    // });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.logger.log('auth guard canActivate called');
    const request = context.switchToHttp().getRequest<Request>();

    // 1. Попытка аутентификации по JWT (Bearer Token)
    const jwtToken = this.extractJwtFromHeader(request);
    if (jwtToken) {
      try {
        const decodedJwt = await this.validateJwt(jwtToken);
        request.hasuraUserId =
          decodedJwt['https://hasura.io/jwt/claims']['x-hasura-user-id'];
        request.hasuraRoles =
          decodedJwt['https://hasura.io/jwt/claims']['x-hasura-allowed-roles'];
        request.isAuthenticated = true;
        this.logger.debug(
          `Authenticated by JWT: User ID ${request.hasuraUserId}, Roles: ${request.hasuraRoles}`,
        );
        return true; // JWT успешно аутентифицирован
      } catch (jwtError) {
        this.logger.warn(`JWT validation failed: ${jwtError.message}`);
        // Не бросаем ошибку сразу, даем шанс кукам
      }
    }

    // 2. Попытка аутентификации по Кукам (Session ID)
    // const sessionId = this.extractSessionIdFromCookie(request);
    if (this.betterAuthApiUrl) {
      try {
        const userDetails = await this.validateSessionWithBetterAuth(request);
        request.hasuraUserId = userDetails.userId;
        request.hasuraRoles = userDetails.roles;
        request.isAuthenticated = true;
        this.logger.debug(
          `Authenticated by Cookie: User ID ${request.hasuraUserId}, Roles: ${request.hasuraRoles}`,
        );
        return true; // Куки успешно аутентифицированы
      } catch (cookieError) {
        this.logger.warn(
          `Cookie validation failed with BetterAuth: ${cookieError.message}`,
        );
      }
    }

    // Если ни JWT, ни куки не дали аутентификации, рассматриваем как анонимного пользователя.
    // Для анонимных пользователей устанавливаем роль 'anonymous'.
    // Hasura по умолчанию использует 'x-hasura-role' как 'anonymous', если нет других заголовков.
    request.hasuraUserId = undefined; // Или 'public' или 'guest', в зависимости от вашей логики
    request.hasuraRoles = ['anonymous'];
    request.isAuthenticated = false;
    this.logger.debug('No authentication found, treating as anonymous.');
    return true; // Разрешаем доступ, но как анонимному пользователю
  }

  private extractJwtFromHeader(request: Request): string | null {
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7, authHeader.length);
    }
    return null;
  }

  private async validateJwt(token: string): Promise<any> {
    // Если HASURA_GRAPHQL_JWT_SECRET это JWKS URL:
    // const decodedHeader = jwt.decode(token, { complete: true })?.header;
    // if (!decodedHeader || !decodedHeader.kid) {
    //   throw new UnauthorizedException('Invalid JWT token header or missing KID');
    // }
    // const key = await this.jwksClient.getSigningKey(decodedHeader.kid);
    // const signingKey = key.getPublicKey();
    // return jwt.verify(token, signingKey, { algorithms: ['RS256'] }); // Или другой алгоритм

    // В нашем случае HASURA_GRAPHQL_JWT_SECRET это простая строка:
    if (!this.hasuraJwtSecret) {
      throw new InternalServerErrorException('JWT secret is not configured.');
    }
    return jwt.verify(token, this.hasuraJwtSecret, { algorithms: ['HS256'] }); // Обычно HS256 для симметричных секретов
  }

  private async validateSessionWithBetterAuth(
    request: Request,
  ): Promise<{ userId: string; roles: string[] }> {
    // Реальный запрос к Auth-сервису по эндпоинту /hasura
    try {
      // Используем node-fetch (или встроенный fetch в Node 18+)
      const fetch = (global as any).fetch || require('node-fetch');
      const response = await fetch('http://auth:3000/hasura', {
        method: 'GET',
        headers: request.headers,
      });

      const bodyText = await response.text();

      if (!response.ok) {
        this.logger.error(
          `Auth service responded with status ${response.status}`,
        );
        throw new UnauthorizedException(
          'Session validation failed with Auth service',
        );
      }

      const data = JSON.parse(bodyText);

      console.log('Auth service response data:', data);

      // Ожидаем, что Auth возвращает userId и roles
      if (!data['X-Hasura-User-Id'] || !data['X-Hasura-Role']) {
        throw new UnauthorizedException('Invalid response from Auth service');
      }
      console.log('Auth service response:', data);
      return {
        userId: data['X-Hasura-User-Id'],
        roles: [data['X-Hasura-Role']],
      };
    } catch (error: any) {
      this.logger.error(`Error connecting to Auth service: ${error.message}`);
      throw new InternalServerErrorException('Auth service connection error');
    }
  }
}
