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
  let fileId: string;
  let sessionCookie: string;
  let sessionCookieUserB: string;

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

    console.log('App initialized going to auth');

    // Функция для обеспечения существования пользователя (регистрация + вход)
    const ensureUser = async (email: string, name: string) => {
      // Пытаемся зарегистрировать (на случай если его нет)
      await fetch('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password1234',
          name,
        }),
      });

      // Входим
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

      const setCookie = loginRes.headers.get('set-cookie');
      return setCookie?.split(';')[0] || '';
    };

    // Логиним первого тестового пользователя (John Doe)
    sessionCookie = await ensureUser('john.doe@example.com', 'John Doe');

    // Логиним второго тестового пользователя (Jane Doe)
    sessionCookieUserB = await ensureUser('jane.doe@example.com', 'Jane Doe');

    console.log('Auth cookies obtained:', {
      userA: !!sessionCookie,
      userB: !!sessionCookieUserB,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should start the app and respond to requests', async () => {
    const res = await request(app.getHttpServer())
      .get('/storage/healthz')
      .set('Cookie', sessionCookie);
    expect([200, 404]).toContain(res.status);
  });

  describe('Security & RBAC', () => {
    it('should return 403 when uploading without session cookie (anonymous)', async () => {
      const filePath = path.resolve(__dirname, 'test/testFile.txt');
      return request(app.getHttpServer())
        .post('/storage/upload')
        .attach('file', filePath)
        .expect(403);
    });

    it('should return 403 when downloading without session cookie (anonymous)', async () => {
      return request(app.getHttpServer())
        .get('/storage/download/some-uuid')
        .expect(403);
    });

    it('should return 403 when deleting without session cookie (anonymous)', async () => {
      return request(app.getHttpServer())
        .delete('/storage/some-uuid')
        .expect(403);
    });

    it('should allow access with X-Hasura-Admin-Secret bypass', async () => {
      const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;
      if (!adminSecret) {
        console.warn(
          'Skipping Admin Secret test: HASURA_GRAPHQL_ADMIN_SECRET not set',
        );
        return;
      }

      // Пытаемся получить несуществующий файл, но ожидаем 404 (найден в БД, но нет в MinIO)
      // или 200/400, но ГЛАВНОЕ не 401.
      const res = await request(app.getHttpServer())
        .get('/storage/download/00000000-0000-0000-0000-000000000000')
        .set('x-hasura-admin-secret', adminSecret);

      expect(res.status).not.toBe(401);
    });
  });

  it('should upload a file successfully', async () => {
    console.log('Starting file upload test... at directory:', __dirname);
    const filePath = path.resolve(__dirname, 'test/testFile.txt');
    return request(app.getHttpServer())
      .post('/storage/upload')
      .set('Cookie', sessionCookie)
      .attach('file', filePath)
      .expect(201)
      .then((response) => {
        console.log('File upload response:', response.body);
        fileId = response.body.updatedFileMetadata.id; // Сохраняем ID файла для последующих тестов
        expect(response.body).toHaveProperty('updatedFileMetadata');
        expect(response.body.updatedFileMetadata).toHaveProperty('name');
        expect(response.body.updatedFileMetadata.name).toMatch('testFile.txt');
      });
  });

  describe('Multi-user Isolation', () => {
    it("should not allow User B to delete User A's file", async () => {
      if (!fileId || !sessionCookieUserB) {
        console.warn(
          'Skipping Multi-user test: fileId or User B cookie missing',
        );
        return;
      }

      // User B пытается удалить файл, загруженный User A
      return request(app.getHttpServer())
        .delete(`/storage/${fileId}`)
        .set('Cookie', sessionCookieUserB)
        .expect(404); // Ожидаем 404, так как RLS скрывает файл от User B
    });

    it("should not allow User B to download User A's file", async () => {
      if (!fileId || !sessionCookieUserB) return;

      // Теперь, когда мы изменили права в Hasura, User B не должен иметь доступа к файлу User A
      return request(app.getHttpServer())
        .get(`/storage/download/${fileId}`)
        .set('Cookie', sessionCookieUserB)
        .expect(404); // Ожидаем 404
    });
  });

  it('Should get presigned url successfully', async () => {
    if (!fileId) {
      throw new Error('File ID is not defined. Cannot get presigned URL.');
    }
    return request(app.getHttpServer())
      .get(`/storage/presigned-url/${fileId}`)
      .set('Cookie', sessionCookie)
      .expect(200)
      .then((response) => {
        console.log('Presigned URL response:', response.body);
        expect(response.body).toHaveProperty('url');
      });
  });

  it('Should download a file successfully', async () => {
    if (!fileId) {
      throw new Error('File ID is not defined. Cannot download file.');
    }
    return request(app.getHttpServer())
      .get(`/storage/download/${fileId}`)
      .set('Cookie', sessionCookie)
      .buffer(true)
      .parse((res, callback) => {
        // Собираем все чанки в буфер
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      })
      .expect(200)
      .expect('Content-Disposition', /attachment; filename="testFile.txt"/)
      .then((response) => {
        expect(Buffer.isBuffer(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
      });
  });

  it('Should delete a file successfully', async () => {
    if (!fileId) {
      throw new Error('File ID is not defined. Cannot delete file.');
    }
    return request(app.getHttpServer())
      .delete(`/storage/${fileId}`)
      .set('Cookie', sessionCookie)
      .expect(200);
    // .then((response) => {
    //   console.log('File deletion response:', response.body);
    //   expect(response.body).toHaveProperty(
    //     'message',
    //     'File deleted successfully',
    //   );
    // });
  }, 10000);
});
