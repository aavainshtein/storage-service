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
  ForbiddenException,
  Header,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Request as ExpressRequest } from 'express';
import { MinioService } from '../minio/minio.service';
import { FilesService } from './files.service';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { Multer } from 'multer';
import { AuthGuard } from '../auth/auth/auth.guard';

interface RequestWithHasuraUserId extends ExpressRequest {
  hasuraUserId?: string;
  hasuraRoles?: string[];
}

@Controller('storage')
@UseGuards(AuthGuard)
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
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Multer.File,
    @Req() req: RequestWithHasuraUserId,
  ) {
    console.log('upload endpoint called');
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const uploadedByUserId = req.hasuraUserId; // Может быть undefined, если пользователь анонимный
    const roles = req.hasuraRoles;

    // const objectName = `${file.originalname}`; // Имя файла в MinIO, можно использовать UUID

    try {
      // Проверяем бакет и его настройки (размер, тип)
      const bucketMetadata = await this.filesService.getBucketByName(
        this.bucketName,
        uploadedByUserId,
        roles,
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

      // Сохраняем метаданные файла в Hasura которые обновим после успешной загрузки
      const fileMetadata = await this.filesService.createFileMetadata({
        name: file.originalname, // Используем оригинальное имя файла
        bucketId: bucketMetadata.id, // ID бакета из Hasura
        size: file.size,
        mimeType: file.mimetype,
        uploadedByUserId: uploadedByUserId,
        isUploaded: false, // Устанавливаем false, пока файл не загружен
        roles,
      });

      if (!!fileMetadata?.id) {
        this.logger.log(`File metadata created with ID: ${fileMetadata.id}`);
      }

      const fileStream = Readable.from(file.buffer);
      const uploadedInfo = await this.minioService.uploadFile(
        fileMetadata.id, // Используем ID метаданных как имя объекта
        fileStream,
        file.size,
        { 'Content-Type': file.mimetype, name: file.originalname },
      );

      if (!uploadedInfo) {
        throw new InternalServerErrorException(
          'Failed to upload file to MinIO.',
        );
      }

      // Обновляем метаданные файла после успешной загрузки
      const updatedFileMetadata = await this.filesService.updateFileMetadata({
        id: fileMetadata.id,
        etag: uploadedInfo.etag,
        mimeType: file.mimetype,
        name: file.originalname,
        size: file.size,
        isUploaded: true, // Устанавливаем true, так как файл успешно загружен
        uploadedByUserId: uploadedByUserId,
        roles,
      });

      this.logger.log(
        `File uploaded and metadata saved: ${JSON.stringify(updatedFileMetadata)}`,
      );
      return {
        message: 'File uploaded successfully',
        ...{ updatedFileMetadata },
        // url: publicUrl,
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
  async downloadFile(
    @Param('fileId') fileId: string,
    @Res() res: Response,
    @Req() req: RequestWithHasuraUserId,
  ) {
    const userId = req.hasuraUserId;
    const roles = req.hasuraRoles;

    try {
      const fileMetadata = await this.filesService.getFileMetadata(
        fileId,
        userId,
        roles,
      );
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
  async deleteFile(
    @Param('fileId') fileId: string,
    @Res() res: Response,
    @Req() req: RequestWithHasuraUserId,
  ) {
    const userId = req.hasuraUserId;
    const roles = req.hasuraRoles;

    if (!userId) {
      // Запрещаем удаление анонимным пользователям
      throw new ForbiddenException('Authentication required to delete files.');
    }

    try {
      // Сначала проверяем, имеет ли пользователь доступ к файлу через Hasura
      // Здесь GetFileMetadata может выбросить Forbidden/NotFound если Hasura не дает доступ
      const fileMetadata = await this.filesService.getFileMetadata(
        fileId,
        userId,
        roles,
      );
      if (!fileMetadata) {
        throw new NotFoundException(
          `File with ID ${fileId} not found or not accessible.`,
        );
      }
      // Теперь, когда мы знаем, что пользователь имеет доступ к метаданным,
      // Hasura также проверит разрешение на удаление при вызове deleteFileMetadata
      const objectName = fileMetadata.name;

      await this.minioService.deleteFile(objectName);
      await this.filesService.deleteFileMetadata(fileId, userId, roles); // Передаем userId и roles

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
    @Req() req: RequestWithHasuraUserId,
  ) {
    const userId = req.hasuraUserId;
    const roles = req.hasuraRoles;

    try {
      // Здесь Hasura проверит, имеет ли пользователь доступ к метаданным файла fileId
      const fileMetadata = await this.filesService.getFileMetadata(
        fileId,
        userId,
        roles,
      );
      if (!fileMetadata) {
        throw new NotFoundException(
          `File with ID ${fileId} not found or not accessible.`,
        );
      }

      // Здесь GetBucketByName также будет использовать заголовки пользователя
      const bucketMetadata = await this.filesService.getBucketByName(
        this.bucketName,
        userId,
        roles,
      );
      if (!bucketMetadata || !bucketMetadata.presigned_urls_enabled) {
        throw new BadRequestException(
          `Presigned URLs are not enabled for bucket '${this.bucketName}' or bucket not accessible.`,
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
