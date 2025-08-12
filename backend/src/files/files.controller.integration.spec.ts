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
    // Логиним тестового пользователя и сохраняем session token
    const loginRes = await fetch(
      'http://localhost:3000/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          password: 'password1234',
          rememberMe: true,
        }),
      },
    );

    // Получаем cookie из заголовка set-cookie
    const setCookie = loginRes.headers.get('set-cookie');
    // Обычно берём первую cookie, если их несколько
    sessionCookie = setCookie?.split(';')[0] || ''; // 'better-auth.session_token=...'
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
