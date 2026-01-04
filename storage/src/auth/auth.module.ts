// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [AuthGuard],
  exports: [AuthGuard], // Экспортируем Guard
})
export class AuthModule {}
