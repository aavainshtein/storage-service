// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MinioModule } from './minio/minio.module';
import { ConfigModule } from '@nestjs/config';
import { FilesModule } from './files/files.module'; // Импортируем FilesModule

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
    }),
    MinioModule,
    FilesModule, // Добавляем FilesModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
