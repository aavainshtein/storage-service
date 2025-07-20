// src/files/files.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GraphQLClient, gql } from 'graphql-request';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FilesService {
  private readonly graphqlClient: GraphQLClient; // Теперь это постоянный клиент
  private readonly logger = new Logger(FilesService.name);

  constructor(private configService: ConfigService) {
    const hasuraEndpoint = this.configService.get<string>(
      'HASURA_GRAPHQL_ENDPOINT',
    );
    const hasuraAdminSecret = this.configService.get<string>(
      'HASURA_GRAPHQL_ADMIN_SECRET',
    ); // Возвращаем админский секрет

    if (!hasuraEndpoint || !hasuraAdminSecret) {
      this.logger.error(
        'Hasura configuration is missing environment variables.',
      );
      throw new InternalServerErrorException('Hasura configuration error');
    }

    // Инициализируем клиент один раз с админским секретом
    this.graphqlClient = new GraphQLClient(hasuraEndpoint, {
      headers: {
        'x-hasura-admin-secret': hasuraAdminSecret,
      },
    });
  }

  // Вспомогательный метод для добавления пользовательских заголовков к запросу
  // Это позволит Hasura "знать", кто инициировал запрос, даже если он пришел с админским секретом
  private async executeGraphQLRequest(
    query: string,
    variables: Record<string, any>,
    userId?: string,
    roles?: string[],
  ): Promise<any> {
    const requestHeaders: Record<string, string> = {};

    if (userId) {
      requestHeaders['x-hasura-user-id'] = userId;
    }
    if (roles && roles.length > 0) {
      requestHeaders['x-hasura-role'] = roles[0]; // Основная роль
      requestHeaders['x-hasura-allowed-roles'] = roles.join(','); // Все разрешенные роли
    } else {
      // Если пользователь не аутентифицирован (аноним), явно указываем роль 'anonymous'
      requestHeaders['x-hasura-role'] = 'anonymous';
      requestHeaders['x-hasura-allowed-roles'] = 'anonymous';
    }

    try {
      // Используем постоянный клиент, но добавляем заголовки пользователя
      // Примечание: graphql-request позволяет передавать заголовки непосредственно в метод request
      return await this.graphqlClient.request(query, variables, requestHeaders);
    } catch (error) {
      // Обработка ошибок, специфичных для GraphQL
      // Например, Hasura может вернуть ошибки, если запрос синтаксически неверен,
      // но не будет возвращать 'access-denied' напрямую, если запрос сделан с админским секретом.
      // Ошибки авторизации теперь будут обрабатываться, если вы настроите
      // что-то более сложное на уровне Hasura (например, события или actions).
      // Для наших целей, если вы полагаетесь на Hasura RBAC, это означает,
      // что бэкенд должен знать, что делать, если запрос не может быть выполнен
      // от имени пользователя (например, если Hasura не позволит вставить uploaded_by_user_id).
      this.logger.error(
        `GraphQL request failed: ${error.message}`,
        error.stack,
      );
      // Если вы ожидаете, что Hasura будет отвечать ошибками доступа (даже с админским секретом,
      // если, например, нарушены правила валидации данных, которые имитируют разрешения),
      // вы можете добавить более детальную обработку.
      throw new InternalServerErrorException(
        `Hasura operation failed: ${error.message}`,
      );
    }
  }

  async createFileMetadata(
    name: string,
    bucketId: string,
    size: number,
    mimeType: string,
    etag: string,
    uploadedByUserId: string | undefined, // Может быть undefined для анонимных
    roles: string[],
  ): Promise<{ id: string }> {
    const fileId = uuidv4();

    const mutation = gql`
      mutation InsertFile($id: uuid!, $name: String!, $bucket_id: uuid!, $size: bigint!, $mime_type: String!, $etag: String!, $uploaded_by_user_id: String) {
        insert_storage_files_one(object: {
          id: $id,
          name: $name,
          bucket_id: $bucket_id,
          size: $size,
          mime_type: $mime_type,
          etag: $etag,
          uploaded_by_user_id: $uploaded_by_user_id
        }) {
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

    this.logger.log(
      `Inserting file metadata for ${name} with ID ${fileId} by user ${uploadedByUserId || 'anonymous'}`,
    );
    const data = await this.executeGraphQLRequest(
      mutation,
      variables,
      uploadedByUserId,
      roles,
    );
    return data.insert_storage_files_one;
  }

  async deleteFileMetadata(
    fileId: string,
    userId: string,
    roles: string[],
  ): Promise<{ id: string }> {
    const mutation = gql`
      mutation DeleteFile($id: uuid!) {
        delete_storage_files_by_pk(id: $id) {
          id
        }
      }
    `;

    const variables = { id: fileId };

    this.logger.log(
      `Deleting file metadata for ID ${fileId} by user ${userId}`,
    );
    const data = await this.executeGraphQLRequest(
      mutation,
      variables,
      userId,
      roles,
    );
    if (!data.delete_storage_files_by_pk) {
      throw new NotFoundException(
        `File metadata with ID ${fileId} not found or not accessible for deletion.`,
      );
    }
    return data.delete_storage_files_by_pk;
  }

  async getFileMetadata(
    fileId: string,
    userId?: string,
    roles?: string[],
  ): Promise<any> {
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
            name
          }
        }
      }
    `;
    const variables = { id: fileId };

    this.logger.log(
      `Fetching file metadata for ID ${fileId} by user ${userId || 'anonymous'}`,
    );
    const data = await this.executeGraphQLRequest(
      query,
      variables,
      userId,
      roles,
    );
    if (!data.storage_files_by_pk) {
      // Если Hasura вернула null, это может означать, что файл не существует или пользователь не имеет к нему доступа
      throw new NotFoundException(
        `File with ID ${fileId} not found or not accessible.`,
      );
    }
    return data.storage_files_by_pk;
  }

  async getBucketByName(
    bucketName: string,
    userId?: string,
    roles?: string[],
  ): Promise<any> {
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

    this.logger.log(
      `Fetching bucket metadata for name: ${bucketName} by user ${userId || 'anonymous'}`,
    );
    const data = await this.executeGraphQLRequest(
      query,
      variables,
      userId,
      roles,
    );
    if (data.storage_buckets.length === 0) {
      return null;
    }
    return data.storage_buckets[0];
  }
}
