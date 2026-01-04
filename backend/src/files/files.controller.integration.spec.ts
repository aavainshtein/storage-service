import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as request from 'supertest';

import { FilesModule } from './files.module';

import * as dotenv from 'dotenv';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';

const envPath = path.resolve(__dirname, '../../../.env');
const result = dotenv.config({ path: envPath });

// console.log('Environment variables loaded:', result.parsed);

describe('FilesController Integration tests', () => {
  let app: INestApplication;
  let sessionCookieA: string;
  let sessionCookieB: string;
  let fileIdA: string;
  let fileIdB: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        FilesModule,
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: envPath,
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    const ensureUser = async (email: string, name: string) => {
      await fetch('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password1234', name }),
      });

      const loginRes = await fetch(
        'http://localhost:3000/api/auth/sign-in/email',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password: 'password1234',
            rememberMe: true,
          }),
        },
      );

      return loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    };

    sessionCookieA = await ensureUser('user.a@example.com', 'User A');
    sessionCookieB = await ensureUser('user.b@example.com', 'User B');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('User A - Own File Operations', () => {
    it('should upload file as User A', async () => {
      const filePath = path.resolve(__dirname, 'test/testFile.txt');
      const res = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Cookie', sessionCookieA)
        .attach('file', filePath)
        .expect(201);

      fileIdA = res.body.updatedFileMetadata.id;
      expect(fileIdA).toBeDefined();
    });

    it('should get presigned URL for own file (User A)', async () => {
      await request(app.getHttpServer())
        .get(`/storage/presigned-url/${fileIdA}`)
        .set('Cookie', sessionCookieA)
        .expect(200);
    });

    it('should download own file (User A)', async () => {
      await request(app.getHttpServer())
        .get(`/storage/download/${fileIdA}`)
        .set('Cookie', sessionCookieA)
        .expect(200);
    });
  });

  describe('User B - Own File Operations', () => {
    it('should upload file as User B', async () => {
      const filePath = path.resolve(__dirname, 'test/testFile.txt');
      const res = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Cookie', sessionCookieB)
        .attach('file', filePath)
        .expect(201);

      fileIdB = res.body.updatedFileMetadata.id;
      expect(fileIdB).toBeDefined();
    });

    it('should get presigned URL for own file (User B)', async () => {
      await request(app.getHttpServer())
        .get(`/storage/presigned-url/${fileIdB}`)
        .set('Cookie', sessionCookieB)
        .expect(200);
    });

    it('should download own file (User B)', async () => {
      await request(app.getHttpServer())
        .get(`/storage/download/${fileIdB}`)
        .set('Cookie', sessionCookieB)
        .expect(200);
    });

    it('should delete own file (User B)', async () => {
      await request(app.getHttpServer())
        .delete(`/storage/${fileIdB}`)
        .set('Cookie', sessionCookieB)
        .expect(200);
    });
  });

  describe('Cross-User Access (User B -> User A)', () => {
    it('should not allow User B to get presigned URL for User A file', async () => {
      await request(app.getHttpServer())
        .get(`/storage/presigned-url/${fileIdA}`)
        .set('Cookie', sessionCookieB)
        .expect(404);
    });

    it('should not allow User B to download User A file', async () => {
      await request(app.getHttpServer())
        .get(`/storage/download/${fileIdA}`)
        .set('Cookie', sessionCookieB)
        .expect(404);
    });

    it('should not allow User B to delete User A file', async () => {
      await request(app.getHttpServer())
        .delete(`/storage/${fileIdA}`)
        .set('Cookie', sessionCookieB)
        .expect(404);
    });
  });

  describe('Anonymous Access', () => {
    it('should not allow anonymous upload', async () => {
      const filePath = path.resolve(__dirname, 'test/testFile.txt');
      await request(app.getHttpServer())
        .post('/storage/upload')
        .attach('file', filePath)
        .expect(403);
    });

    it('should not allow anonymous download', async () => {
      await request(app.getHttpServer())
        .get(`/storage/download/${fileIdA}`)
        .expect(403);
    });

    it('should not allow anonymous delete', async () => {
      await request(app.getHttpServer())
        .delete(`/storage/${fileIdA}`)
        .expect(403);
    });
  });

  describe('Admin Access (Bypass)', () => {
    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

    it('should allow admin to get presigned URL for any file', async () => {
      if (!adminSecret) return console.warn('No admin secret');
      await request(app.getHttpServer())
        .get(`/storage/presigned-url/${fileIdA}`)
        .set('x-hasura-admin-secret', adminSecret)
        .expect(200);
    });

    it('should allow admin to download any file', async () => {
      if (!adminSecret) return console.warn('No admin secret');
      await request(app.getHttpServer())
        .get(`/storage/download/${fileIdA}`)
        .set('x-hasura-admin-secret', adminSecret)
        .expect(200);
    });

    it('should allow admin to delete any file', async () => {
      if (!adminSecret) return console.warn('No admin secret');
      await request(app.getHttpServer())
        .delete(`/storage/${fileIdA}`)
        .set('x-hasura-admin-secret', adminSecret)
        .expect(200);
    });
  });
});
