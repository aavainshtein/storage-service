// src/minio/minio.service.ts
import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { Readable } from 'stream';

@Injectable()
export class MinioService {
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(MinioService.name);

  constructor(private configService: ConfigService) {
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT');
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY');
    const secretKey = this.configService.get<string>('MINIO_SECRET_KEY');
    this.bucketName =
      this.configService.get<string>('MINIO_BUCKET_NAME') || 'default-bucket';

    if (!endPoint || !accessKey || !secretKey || !this.bucketName) {
      this.logger.error(
        'MinIO configuration is missing environment variables.',
      );
      throw new InternalServerErrorException('MinIO configuration error');
    }

    const [host, port] = endPoint.split(':');
    const useSSL = endPoint.startsWith('https'); // Определяем, используется ли SSL

    this.minioClient = new Minio.Client({
      endPoint: host,
      port: parseInt(port, 10),
      useSSL: useSSL,
      accessKey: accessKey,
      secretKey: secretKey,
    });

    this.logger.log(
      `MinIO client initialized for endpoint: ${endPoint}, bucket: ${this.bucketName}`,
    );

    // Проверяем существование бакета при старте
    this.ensureBucketExists();
  }

  private async ensureBucketExists() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName, 'us-east-1'); // Регион по умолчанию
        this.logger.log(`Bucket '${this.bucketName}' created successfully.`);
      } else {
        this.logger.log(`Bucket '${this.bucketName}' already exists.`);
      }
    } catch (error) {
      this.logger.error(`Error ensuring MinIO bucket exists: ${error.message}`);
      throw new InternalServerErrorException(
        `MinIO bucket initialization failed: ${error.message}`,
      );
    }
  }

  async uploadFile(
    objectName: string,
    stream: Readable,
    size: number,
    metaData: Minio.ItemBucketMetadata,
  ): Promise<any> {
    // #TODO тип
    try {
      this.logger.log(
        `Uploading file ${objectName} to bucket ${this.bucketName}`,
      );
      return await this.minioClient.putObject(
        this.bucketName,
        objectName,
        stream,
        size,
        metaData,
      );
    } catch (error) {
      this.logger.error(`Error uploading file ${objectName}: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to upload file: ${error.message}`,
      );
    }
  }

  async downloadFile(objectName: string): Promise<Readable> {
    try {
      this.logger.log(
        `Downloading file ${objectName} from bucket ${this.bucketName}`,
      );
      return await this.minioClient.getObject(this.bucketName, objectName);
    } catch (error) {
      this.logger.error(
        `Error downloading file ${objectName}: ${error.message}`,
      );
      if (error.code === 'NoSuchKey') {
        throw new InternalServerErrorException(`File not found: ${objectName}`);
      }
      throw new InternalServerErrorException(
        `Failed to download file: ${error.message}`,
      );
    }
  }

  async deleteFile(objectName: string): Promise<void> {
    try {
      this.logger.log(
        `Deleting file ${objectName} from bucket ${this.bucketName}`,
      );
      await this.minioClient.removeObject(this.bucketName, objectName);
    } catch (error) {
      this.logger.error(`Error deleting file ${objectName}: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to delete file: ${error.message}`,
      );
    }
  }

  async getPresignedUrl(
    objectName: string,
    expiry: number = 300,
  ): Promise<string> {
    try {
      this.logger.log(
        `Generating presigned URL for ${objectName} with expiry ${expiry}s`,
      );
      return await this.minioClient.presignedGetObject(
        this.bucketName,
        objectName,
        expiry,
      );
    } catch (error) {
      this.logger.error(
        `Error generating presigned URL for ${objectName}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Failed to generate presigned URL: ${error.message}`,
      );
    }
  }

  // Метод для получения информации о файле (если потребуется eTag или другие метаданные)
  async statFile(objectName: string): Promise<any> {
    // #TODO тип
    try {
      this.logger.log(`Getting stats for file ${objectName}`);
      return await this.minioClient.statObject(this.bucketName, objectName);
    } catch (error) {
      this.logger.error(
        `Error getting stats for file ${objectName}: ${error.message}`,
      );
      if (error.code === 'NoSuchKey') {
        throw new InternalServerErrorException(
          `File stats not found: ${objectName}`,
        );
      }
      throw new InternalServerErrorException(
        `Failed to get file stats: ${error.message}`,
      );
    }
  }
}
