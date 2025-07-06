// src/files/files.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { GraphQLClient, gql } from 'graphql-request';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid'; // Для генерации UUID для файла

@Injectable()
export class FilesService {
  private readonly graphqlClient: GraphQLClient;
  private readonly logger = new Logger(FilesService.name);

  constructor(private configService: ConfigService) {
    const hasuraEndpoint = this.configService.get<string>(
      'HASURA_GRAPHQL_ENDPOINT',
    );
    const hasuraAdminSecret = this.configService.get<string>(
      'HASURA_GRAPHQL_ADMIN_SECRET',
    );

    if (!hasuraEndpoint || !hasuraAdminSecret) {
      this.logger.error(
        'Hasura configuration is missing environment variables.',
      );
      throw new InternalServerErrorException('Hasura configuration error');
    }

    this.graphqlClient = new GraphQLClient(hasuraEndpoint, {
      headers: {
        'x-hasura-admin-secret': hasuraAdminSecret,
      },
    });
  }

  async createFileMetadata(
    name: string,
    bucketId: string,
    size: number,
    mimeType: string,
    etag: string,
    uploadedByUserId?: string,
  ): Promise<{ id: string }> {
    const fileId = uuidv4(); // Генерируем UUID для файла

    const mutation = gql`
      mutation InsertFile(
        $id: uuid!
        $name: String!
        $bucket_id: uuid!
        $size: bigint!
        $mime_type: String!
        $etag: String!
        $uploaded_by_user_id: String
      ) {
        insert_storage_files_one(
          object: {
            id: $id
            name: $name
            bucket_id: $bucket_id
            size: $size
            mime_type: $mime_type
            etag: $etag
            uploaded_by_user_id: $uploaded_by_user_id
          }
        ) {
          id
        }
      }
    `;

    const variables = {
      id: fileId,
      name,
      bucket_id: bucketId,
      size,
      mime_type: mimeType,
      etag,
      uploaded_by_user_id: uploadedByUserId,
    };

    try {
      this.logger.log(`Inserting file metadata for ${name} with ID ${fileId}`);
      const data = (await this.graphqlClient.request(mutation, variables)) as {
        insert_storage_files_one: { id: string };
      };
      return data.insert_storage_files_one;
    } catch (error) {
      this.logger.error(
        `Error inserting file metadata: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to save file metadata: ${error.message}`,
      );
    }
  }

  async deleteFileMetadata(fileId: string): Promise<{ id: string }> {
    const mutation = gql`
      mutation DeleteFile($id: uuid!) {
        delete_storage_files_by_pk(id: $id) {
          id
        }
      }
    `;

    const variables = { id: fileId };

    try {
      this.logger.log(`Deleting file metadata for ID ${fileId}`);
      const data = (await this.graphqlClient.request(mutation, variables)) as {
        delete_storage_files_by_pk: { id: string } | null;
      };
      if (!data.delete_storage_files_by_pk) {
        throw new InternalServerErrorException(
          `File metadata with ID ${fileId} not found.`,
        );
      }
      return data.delete_storage_files_by_pk;
    } catch (error) {
      this.logger.error(
        `Error deleting file metadata: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to delete file metadata: ${error.message}`,
      );
    }
  }

  async getFileMetadata(fileId: string): Promise<any> {
    const query = gql`
      query GetFile($id: uuid!) {
        storage_files_by_pk(id: $id) {
          id
          name
          bucket_id
          size
          mime_type
          etag
          uploaded_by_user_id
          created_at
          updated_at
          bucket {
            # Получаем информацию о бакете
            name
          }
        }
      }
    `;
    const variables = { id: fileId };

    try {
      this.logger.log(`Fetching file metadata for ID ${fileId}`);
      const data = (await this.graphqlClient.request(query, variables)) as {
        storage_files_by_pk: any;
      };
      return data.storage_files_by_pk;
    } catch (error) {
      this.logger.error(
        `Error fetching file metadata: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to fetch file metadata: ${error.message}`,
      );
    }
  }

  async getBucketByName(bucketName: string): Promise<any> {
    const query = gql`
      query GetBucketByName($name: String!) {
        storage_buckets(where: { name: { _eq: $name } }) {
          id
          name
          min_upload_size
          max_upload_size
          allowed_mime_types
          cache_control
          download_expiration
          presigned_urls_enabled
        }
      }
    `;
    const variables = { name: bucketName };

    try {
      this.logger.log(`Fetching bucket metadata for name: ${bucketName}`);
      const data = (await this.graphqlClient.request(query, variables)) as {
        storage_buckets: any[];
      };
      if (data.storage_buckets.length === 0) {
        return null;
      }
      return data.storage_buckets[0];
    } catch (error) {
      this.logger.error(
        `Error fetching bucket metadata: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to fetch bucket metadata: ${error.message}`,
      );
    }
  }
}
