import { Test, TestingModule } from '@nestjs/testing';
import { MinioService } from './minio.service';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import * as Minio from 'minio';

describe('MinioService', () => {
  let service: MinioService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        MINIO_ENDPOINT: 'localhost:9000',
        MINIO_ACCESS_KEY: 'minioadmin',
        MINIO_SECRET_KEY: 'minioadminpassword',
        MINIO_DEFAULT_BUCKET_NAME: 'constante-storage',
      };
      return config[key];
    }),
  };

  // Mock MinIO client methods
  const mockMinioClient = {
    bucketExists: jest.fn().mockResolvedValue(true),
    makeBucket: jest.fn().mockResolvedValue(undefined),
    putObject: jest.fn().mockResolvedValue({ etag: 'mock-etag' }),
    getObject: jest.fn(),
    removeObject: jest.fn(),
    presignedGetObject: jest.fn(),
    statObject: jest.fn(),
  };

  beforeEach(async () => {
    // Mock the Minio.Client constructor
    jest
      .spyOn(Minio, 'Client')
      .mockImplementation(() => mockMinioClient as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MinioService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<MinioService>(MinioService);
    configService = module.get<ConfigService>(ConfigService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize with mocked configuration', () => {
    expect(configService.get('MINIO_ENDPOINT')).toBe('localhost:9000');
    expect(configService.get('MINIO_DEFAULT_BUCKET_NAME')).toBe(
      'constante-storage',
    );
  });

  describe('uploadFile', () => {
    it('should upload a file successfully', async () => {
      // Arrange
      const objectName = 'test-file.txt';
      const fileContent = 'Hello, World!';
      const stream = Readable.from([fileContent]);
      const size = Buffer.byteLength(fileContent);
      const metaData = { 'Content-Type': 'text/plain' };
      const expectedResult = { etag: 'mock-etag' };

      mockMinioClient.putObject.mockResolvedValue(expectedResult);

      // Act
      const result = await service.uploadFile({
        objectName,
        stream,
        size,
        metaData,
      });
      // console.log('Upload result:', result);
      // Assert
      expect(result).toEqual(expectedResult);
      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'constante-storage',
        objectName,
        stream,
        size,
        metaData,
      );
      expect(mockMinioClient.putObject).toHaveBeenCalledTimes(1);
    });

    it('should handle upload errors', async () => {
      // Arrange
      const objectName = 'test-file.txt';
      const stream = Readable.from(['test content']);
      const size = 12;
      const metaData = { 'Content-Type': 'text/plain' };
      const errorMessage = 'MinIO upload error';

      mockMinioClient.putObject.mockRejectedValue(new Error(errorMessage));

      // Act & Assert
      await expect(
        service.uploadFile({ objectName, stream, size, metaData }),
      ).rejects.toThrow(`Failed to upload file: ${errorMessage}`);

      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'constante-storage',
        objectName,
        stream,
        size,
        metaData,
      );
    });

    it('should upload with different file types', async () => {
      // Arrange
      const testCases = [
        {
          objectName: 'image.jpg',
          content: 'image-data',
          metaData: { 'Content-Type': 'image/jpeg' },
        },
        {
          objectName: 'document.pdf',
          content: 'pdf-data',
          metaData: { 'Content-Type': 'application/pdf' },
        },
      ];

      mockMinioClient.putObject.mockResolvedValue({ etag: 'mock-etag' });

      // Act & Assert
      for (const testCase of testCases) {
        const stream = Readable.from([testCase.content]);
        const size = Buffer.byteLength(testCase.content);

        const result = await service.uploadFile({
          objectName: testCase.objectName,
          stream,
          size,
          metaData: testCase.metaData,
        });

        expect(result).toEqual({ etag: 'mock-etag' });
        expect(mockMinioClient.putObject).toHaveBeenCalledWith(
          'constante-storage',
          testCase.objectName,
          stream,
          size,
          testCase.metaData,
        );
      }
    });
  });
});
