// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MinioModule } from './minio/minio.module';
import { ConfigModule } from '@nestjs/config';
import { FilesModule } from './files/files.module'; // Импортируем FilesModule
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // envFilePath: '../../.env',
      envFilePath:
        process.env.NODE_ENV === 'development' ? '.env' : '../../.env',
    }),
    MinioModule,
    FilesModule,
    AuthModule, // Добавляем FilesModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
