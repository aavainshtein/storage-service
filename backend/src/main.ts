// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser'; // Импортируем cookie-parser

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser()); // Используем cookie-parser

  // Если ваш фронтенд будет на другом домене, вам понадобится CORS
  app.enableCors({
    origin: true, // В продакшене укажите конкретные домены
    credentials: true, // Разрешить куки и заголовки авторизации
    allowedHeaders:
      'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  const port = process.env.PORT || 8000;
  await app.listen(port, () => {
    console.log(`Application is running on: http://localhost:${port}`);
  });
}
bootstrap();
