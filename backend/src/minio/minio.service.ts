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
  private readonly defaultBucketName: string;
  private readonly logger = new Logger(MinioService.name);

  constructor(private configService: ConfigService) {
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT');
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY');
    const secretKey = this.configService.get<string>('MINIO_SECRET_KEY');

    // console.log('configService:', this.configService.get('MINIO_ROOT_USER'));

    this.defaultBucketName =
      this.configService.get<string>('MINIO_DEFAULT_BUCKET_NAME') ||
      'default-bucket';

    if (!endPoint) {
      this.logger.error('MinIO configuration is missing MINIO_ENDPOINT.');
      throw new InternalServerErrorException(
        'MinIO configuration error: MINIO_ENDPOINT',
      );
    }
    if (!accessKey) {
      this.logger.error('MinIO configuration is missing MINIO_ACCESS_KEY.');
      throw new InternalServerErrorException(
        'MinIO configuration error: MINIO_ACCESS_KEY.',
      );
    }
    if (!secretKey) {
      this.logger.error('MinIO configuration is missing MINIO_SECRET_KEY.');
      throw new InternalServerErrorException(
        'MinIO configuration error: MINIO_SECRET_KEY.',
      );
    }
    if (!this.defaultBucketName) {
      this.logger.error(
        'MinIO configuration is missing MINIO_DEFAULT_BUCKET_NAME.',
      );
      throw new InternalServerErrorException(
        'MinIO configuration error: MINIO_DEFAULT_BUCKET_NAME',
      );
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
      `MinIO client initialized for endpoint: ${endPoint}, default bucket: ${this.defaultBucketName}`,
    );

    // Проверяем существование дефолтного бакета при старте
    this.ensureBucketExists(this.defaultBucketName);
  }

  private async ensureBucketExists(bucketName: string) {
    try {
      const exists = await this.minioClient.bucketExists(bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(bucketName, 'us-east-1'); // Регион по умолчанию
        this.logger.log(`Bucket '${bucketName}' created successfully.`);
      } else {
        this.logger.log(`Bucket '${bucketName}' already exists.`);
      }
    } catch (error) {
      this.logger.error(`Error ensuring MinIO bucket exists: ${error.message}`);
      throw new InternalServerErrorException(
        `MinIO bucket initialization failed: ${error.message}`,
      );
    }
  }

  async uploadFile({
    objectName,
    stream,
    size,
    metaData,
    bucketName,
  }: {
    objectName: string;
    stream: Readable;
    size: number;
    metaData: Minio.ItemBucketMetadata;
    bucketName?: string;
  }): Promise<any> {
    // #TODO тип
    const targetBucket = bucketName || this.defaultBucketName;
    await this.ensureBucketExists(targetBucket);
    try {
      this.logger.log(`Uploading file ${objectName} to bucket ${targetBucket}`);
      return await this.minioClient.putObject(
        targetBucket,
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

  async downloadFile(
    objectName: string,
    bucketName?: string,
  ): Promise<Readable> {
    const targetBucket = bucketName || this.defaultBucketName;
    try {
      this.logger.log(
        `Downloading file ${objectName} from bucket ${targetBucket}`,
      );
      return await this.minioClient.getObject(targetBucket, objectName);
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

  async deleteFile(
    objectName: string,
    bucketName?: string,
  ): Promise<{ message: string }> {
    const targetBucket = bucketName || this.defaultBucketName;
    try {
      this.logger.log(
        `Deleting file ${objectName} from bucket ${targetBucket}`,
      );
      await this.minioClient.removeObject(targetBucket, objectName);
      this.logger.log(`File ${objectName} deleted successfully.`);
      return {
        message: `File ${objectName} deleted successfully from s3 storage.`,
      };
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
    bucketName?: string,
  ): Promise<string> {
    const targetBucket = bucketName || this.defaultBucketName;
    try {
      this.logger.log(
        `Generating presigned URL for ${objectName} in bucket ${targetBucket} with expiry ${expiry}s`,
      );
      return await this.minioClient.presignedGetObject(
        targetBucket,
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
  async statFile(objectName: string, bucketName?: string): Promise<any> {
    // #TODO тип
    const targetBucket = bucketName || this.defaultBucketName;
    try {
      this.logger.log(
        `Getting stats for file ${objectName} in bucket ${targetBucket}`,
      );
      return await this.minioClient.statObject(targetBucket, objectName);
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
