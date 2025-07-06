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
        expect(response.body).toHaveProperty('fileName');
        expect(response.body.fileName).toMatch('testFile.txt');
      });
  });
});
