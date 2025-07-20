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

console.log('Environment variables loaded:', result.parsed);

describe('FilesController Integration tests', () => {
  let app: INestApplication;
  let fileId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // imports: [
      //   ConfigModule.forRoot({
      //     isGlobal: true,
      //     // envFilePath: '../../.env',
      //     envFilePath:
      //       process.env.NODE_ENV === 'development' ? '.env' : '../../.env',
      //   }),
      //   // MinioModule,
      //   FilesModule, // Добавляем FilesModule
      // ],
      // controllers: [AppController],
      // providers: [AppService],

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('should start the app and respond to requests', async () => {
    const res = await request(app.getHttpServer()).get('/storage/healthz');
    // Если у тебя нет эндпоинта /storage/healthz, можно ожидать 404
    expect([200, 404]).toContain(res.status);
  });

  it('should upload a file successfully', async () => {
    console.log('Starting file upload test... at directory:', __dirname);
    const filePath = path.resolve(__dirname, 'test/testFile.txt');
    return request(app.getHttpServer())
      .post('/storage/upload')
      .attach('file', filePath)
      .expect(201)
      .then((response) => {
        console.log('File upload response:', response.body);
        fileId = response.body.fileId; // Сохраняем ID файла для последующих тестов
        expect(response.body).toHaveProperty('fileName');
        expect(response.body.fileName).toMatch('testFile.txt');
      });
  });

  it('Should get presigned url successfully', async () => {
    if (!fileId) {
      throw new Error('File ID is not defined. Cannot get presigned URL.');
    }
    return request(app.getHttpServer())
      .get(`/storage/presigned-url/${fileId}`)
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
      .expect(200)
      .then((response) => {
        console.log('File deletion response:', response.body);
        expect(response.body).toHaveProperty(
          'message',
          'File deleted successfully',
        );
      });
  });
});
