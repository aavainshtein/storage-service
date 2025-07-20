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
    const sessionId = this.extractSessionIdFromCookie(request);
    if (sessionId && this.betterAuthApiUrl) {
      try {
        const userDetails = await this.validateSessionWithBetterAuth(sessionId);
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

  private extractSessionIdFromCookie(request: Request): string | null {
    // NestJS не парсит куки по умолчанию. Вам нужно будет использовать 'cookie-parser'
    // Или получать куки напрямую из заголовка 'Cookie'
    const cookieHeader = request.headers['cookie'];
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').map((c) => c.trim());
      const connectSidCookie = cookies.find((cookie) =>
        cookie.startsWith('connect.sid='),
      );
      if (connectSidCookie) {
        // Удаляем 'connect.sid=' и '.s:' и '.<signature>'
        let sessionId = connectSidCookie.substring('connect.sid='.length);
        // Если куки включают префикс "s:" и суффикс с подписью, как у Express Session
        if (sessionId.startsWith('s%3A')) {
          // s: в URL-кодировке
          sessionId = decodeURIComponent(sessionId.substring(4)); // Удаляем 's%3A'
          sessionId = sessionId.split('.')[0]; // Удаляем подпись
        }
        return sessionId;
      }
    }
    return null;
  }

  private async validateSessionWithBetterAuth(
    sessionId: string,
  ): Promise<{ userId: string; roles: string[] }> {
    // ЭТО ЗАГЛУШКА! В реальном проекте здесь будет HTTP-запрос к вашему BetterAuth API
    // для валидации сессии и получения user_id и ролей.
    this.logger.warn(
      `MOCK: Validating session ID '${sessionId}' with BetterAuth API.`,
    );

    // Пример заглушки:
    if (sessionId === 'mock-valid-session-id') {
      return { userId: 'mock-user-id-123', roles: ['user'] };
    }
    if (sessionId === 'mock-admin-session-id') {
      return { userId: 'mock-admin-id-456', roles: ['admin', 'user'] };
    }
    throw new UnauthorizedException('Invalid session ID with BetterAuth');

    // Пример реального запроса (псевдокод):
    /*
    try {
      const response = await fetch(`${this.betterAuthApiUrl}/validate-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        this.logger.error(`BetterAuth API responded with status ${response.status}`);
        throw new UnauthorizedException('Session validation failed with BetterAuth');
      }

      const data = await response.json();
      // Убедитесь, что ваш BetterAuth API возвращает userId и roles в нужном формате
      if (!data.userId || !data.roles || !Array.isArray(data.roles)) {
        throw new UnauthorizedException('Invalid response from BetterAuth API');
      }
      return { userId: data.userId, roles: data.roles };
    } catch (error) {
      this.logger.error(`Error connecting to BetterAuth API: ${error.message}`);
      throw new InternalServerErrorException('BetterAuth API connection error');
    }
    */
  }
}
