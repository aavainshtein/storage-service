// src/files/files.controller.ts
import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Res,
  UploadedFile,
  UseInterceptors,
  InternalServerErrorException,
  NotFoundException,
  Logger,
  BadRequestException,
  Header,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { MinioService } from '../minio/minio.service';
import { FilesService } from './files.service';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { Multer } from 'multer';

@Controller('storage')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);
  private readonly bucketName: string;
  private readonly storagePublicUrl: string;

  constructor(
    private readonly minioService: MinioService,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService,
  ) {
    const bucketName = this.configService.get<string>('MINIO_BUCKET_NAME');
    if (!bucketName) {
      throw new Error(
        'MINIO_BUCKET_NAME is not defined in environment variables',
      );
    }
    this.bucketName = bucketName;

    const storagePublicUrl =
      this.configService.get<string>('STORAGE_PUBLIC_URL');
    if (!storagePublicUrl) {
      throw new Error(
        'STORAGE_PUBLIC_URL is not defined in environment variables',
      );
    }
    this.storagePublicUrl = storagePublicUrl;
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file')) // 'file' - это имя поля в форме, которое содержит файл
  async uploadFile(@UploadedFile() file: Multer.File) {
    console.log('upload endpoint called');
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const objectName = `${file.originalname}`; // Имя файла в MinIO, можно использовать UUID

    try {
      // Проверяем бакет и его настройки (размер, тип)
      const bucketMetadata = await this.filesService.getBucketByName(
        this.bucketName,
      );
      if (!bucketMetadata) {
        throw new InternalServerErrorException(
          `Bucket '${this.bucketName}' not found in metadata.`,
        );
      }

      if (
        bucketMetadata.max_upload_size &&
        file.size > bucketMetadata.max_upload_size
      ) {
        throw new BadRequestException(
          `File size exceeds maximum allowed size of ${bucketMetadata.max_upload_size} bytes.`,
        );
      }

      if (
        bucketMetadata.allowed_mime_types &&
        bucketMetadata.allowed_mime_types.length > 0 &&
        !bucketMetadata.allowed_mime_types.includes(file.mimetype)
      ) {
        throw new BadRequestException(
          `File type '${file.mimetype}' is not allowed.`,
        );
      }

      const fileStream = Readable.from(file.buffer);
      const uploadedInfo = await this.minioService.uploadFile(
        objectName,
        fileStream,
        file.size,
        { 'Content-Type': file.mimetype },
      );

      // Сохраняем метаданные файла в Hasura
      const fileMetadata = await this.filesService.createFileMetadata(
        file.originalname, // Используем оригинальное имя файла
        bucketMetadata.id, // ID бакета из Hasura
        file.size,
        file.mimetype,
        uploadedInfo.etag,
        // uploadedByUserId: 'some-user-id' // TODO: Добавить реальный ID пользователя из токена аутентификации
      );

      const publicUrl = `${this.storagePublicUrl}/storage/download/${fileMetadata.id}`; // URL для скачивания через наш сервис

      this.logger.log(`File uploaded and metadata saved: ${fileMetadata.id}`);
      return {
        message: 'File uploaded successfully',
        fileId: fileMetadata.id,
        fileName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        etag: uploadedInfo.etag,
        url: publicUrl,
      };
    } catch (error) {
      this.logger.error(
        `Error during file upload: ${error.message}`,
        error.stack,
      );
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  @Get('download/:fileId')
  @Header('Content-Type', 'application/octet-stream') // Заголовок по умолчанию, будет переопределен
  async downloadFile(@Param('fileId') fileId: string, @Res() res: Response) {
    try {
      const fileMetadata = await this.filesService.getFileMetadata(fileId);
      if (!fileMetadata) {
        throw new NotFoundException(`File with ID ${fileId} not found.`);
      }

      const objectName = fileMetadata.name; // Имя файла в MinIO
      const fileStream = await this.minioService.downloadFile(objectName);

      res.setHeader('Content-Type', fileMetadata.mime_type);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileMetadata.name}"`,
      );
      res.setHeader('Content-Length', fileMetadata.size);

      fileStream.pipe(res);
    } catch (error) {
      this.logger.error(
        `Error during file download: ${error.message}`,
        error.stack,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to download file');
    }
  }

  @Delete(':fileId')
  async deleteFile(@Param('fileId') fileId: string) {
    try {
      const fileMetadata = await this.filesService.getFileMetadata(fileId);
      if (!fileMetadata) {
        throw new NotFoundException(`File with ID ${fileId} not found.`);
      }

      const objectName = fileMetadata.name; // Имя файла в MinIO

      await this.minioService.deleteFile(objectName);
      await this.filesService.deleteFileMetadata(fileId);

      return { message: 'File deleted successfully', fileId };
    } catch (error) {
      this.logger.error(
        `Error during file deletion: ${error.message}`,
        error.stack,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete file');
    }
  }

  @Get('presigned-url/:fileId')
  async getPresignedUrl(
    @Param('fileId') fileId: string,
    @Query('expiry') expiry: string,
  ) {
    try {
      const fileMetadata = await this.filesService.getFileMetadata(fileId);
      if (!fileMetadata) {
        throw new NotFoundException(`File with ID ${fileId} not found.`);
      }

      const bucketMetadata = await this.filesService.getBucketByName(
        this.bucketName,
      );
      if (!bucketMetadata || !bucketMetadata.presigned_urls_enabled) {
        throw new BadRequestException(
          `Presigned URLs are not enabled for bucket '${this.bucketName}'.`,
        );
      }

      const objectName = fileMetadata.name;
      const expirySeconds = expiry
        ? parseInt(expiry, 10)
        : bucketMetadata.download_expiration || 300; // По умолчанию 300 секунд или из метаданных бакета

      const url = await this.minioService.getPresignedUrl(
        objectName,
        expirySeconds,
      );
      return { url };
    } catch (error) {
      this.logger.error(
        `Error generating presigned URL: ${error.message}`,
        error.stack,
      );
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to generate presigned URL',
      );
    }
  }
}
