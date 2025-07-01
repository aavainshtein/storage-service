import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MinioModule } from '../minio/minio.module'; // Add this import

@Module({
  imports: [MinioModule], // Add MinioModule to imports
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
