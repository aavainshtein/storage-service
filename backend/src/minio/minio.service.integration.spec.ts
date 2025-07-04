import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MinioService } from './minio.service';
import { Readable } from 'stream';

import * as dotenv from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../../../.env');
const result = dotenv.config({ path: envPath });

describe('MinioService Integration Tests', () => {
  let service: MinioService;
  let configService: ConfigService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
      ],
      providers: [MinioService],
    }).compile();

    service = module.get<MinioService>(MinioService);
    configService = module.get<ConfigService>(ConfigService);
  });

  // Интеграционные тесты с реальным MinIO и одним файлом
  // Arrange
  const objectName = `test-${Date.now()}.txt`;
  const fileContent = 'Hello, Integration Test!';
  const stream = Readable.from([Buffer.from(fileContent)]);
  const size = Buffer.byteLength(fileContent);
  const metaData = { 'Content-Type': 'text/plain' };

  describe('Real MinIO Operations', () => {
    it('should upload and download file successfully', async () => {
      // Act - Upload
      const uploadResult = await service.uploadFile(
        objectName,
        stream,
        size,
        metaData,
      );
      expect(uploadResult.etag).toBeDefined();

      // Act - Download
      const downloadStream = await service.downloadFile(objectName);
      const chunks: Buffer[] = [];

      for await (const chunk of downloadStream) {
        chunks.push(chunk);
      }

      const downloadedContent = Buffer.concat(chunks).toString();

      // Assert
      expect(downloadedContent).toBe(fileContent);
    });

    it('should generate working presigned URL', async () => {
      // Act
      const presignedUrl = await service.getPresignedUrl(objectName, 300);

      // Assert - URL should be accessible
      expect(presignedUrl).toMatch(/^https?:\/\//);
    });

    it('should get file statistics', async () => {
      // Act
      const stats = await service.statFile(objectName);

      // Assert
      expect(stats.size).toBe(size);
      expect(stats.lastModified).toBeInstanceOf(Date);
      expect(stats.etag).toBeDefined();
    });

    it('should handle file deletion', async () => {
      // Act - Delete
      await service.deleteFile(objectName);

      // Assert - Attempt to download should throw an error
      await expect(service.downloadFile(objectName)).rejects.toThrow(
        'File not found',
      );
    });
  });

  afterAll(async () => {
    // Очистка после всех тестов, если нужно
  });
});
