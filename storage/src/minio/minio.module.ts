import { Module } from '@nestjs/common';
import { MinioService } from './minio.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule], // Импортируем ConfigModule для доступа к переменным окружения
  providers: [MinioService],
  exports: [MinioService], // Экспортируем MinioService для использования в других модулях
})
export class MinioModule {}
