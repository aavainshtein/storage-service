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
      requestHeaders['X-Hasura-User-Id'] = userId;
    }
    if (roles && roles.length > 0) {
      requestHeaders['X-Hasura-Role'] = roles[0]; // Основная роль
      console.log('requestHeaders:', requestHeaders);
      // requestHeaders['X-Hasura-Allowed-Roles'] = roles.join(','); // Все разрешенные роли
    } else {
      // Если пользователь не аутентифицирован (аноним), явно указываем роль 'anonymous'
      requestHeaders['X-Hasura-Role'] = 'anonymous';
      // requestHeaders['X-Hasura-Allowed-Roles'] = 'user';
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

  async createFileMetadata(input: {
    name: string;
    bucketId: string;
    size: number | null;
    mimeType: string | null; // Может быть null, если тип не указан
    etag?: string | null;
    isUploaded?: boolean; // По умолчанию false, если не указано
    uploadedByUserId?: string; // Может быть undefined для анонимных пользователей
    roles?: string[];
  }): Promise<{ id: string }> {
    const mutation = gql`
      mutation InsertFile($object: storage_files_insert_input!) {
        insert_storage_files_one(object: $object) {
          id
          updated_at
          bucket_id
          created_at
          etag
          is_uploaded
          mime_type
          name
          size
          uploaded_by_user_id
        }
      }
    `;

    const variables = {
      object: {
        name: input.name,
        bucket_id: input.bucketId,
        ...(input.size !== null ? { size: input.size } : {}),
        ...(input.mimeType ? { mime_type: input.mimeType } : {}),
        ...(input.etag ? { etag: input.etag } : {}),
        ...(input.isUploaded !== undefined
          ? { is_uploaded: input.isUploaded }
          : { is_uploaded: false }), // По умолчанию false, если не указано
        uploaded_by_user_id: input.uploadedByUserId || null, // Если пользователь анонимный, оставляем null
      },
    };

    this.logger.log(
      `Inserting file metadata for ${input.name} by user ${input.uploadedByUserId || 'anonymous'}`,
    );

    const data = await this.executeGraphQLRequest(
      mutation,
      variables,
      input.uploadedByUserId,
      input.roles,
    );
    return data.insert_storage_files_one;
  }

  async updateFileMetadata(input: {
    id: string;
    etag?: string;
    mimeType?: string;
    name?: string;
    size?: number;
    isUploaded?: boolean; // По умолчанию true, если не указано
  }): Promise<{
    id: string;
    updated_at: string;
    uploaded_by_user_id: string;
    size: number;
    name: string;
    mime_type: string;
    is_uploaded: boolean;
    etag: string;
    created_at: string;
    bucket_id: string;
  }> {
    if (!input.id) {
      throw new InternalServerErrorException('File ID is required for update');
    }

    if (!input.etag && !input.mimeType && !input.name && !input.size) {
      throw new InternalServerErrorException(
        'At least one field must be provided for update',
      );
    }

    const mutation = gql`
      mutation Storage_UpdateStorageFile(
        $etag: String = ""
        $mime_type: String = ""
        $name: String = ""
        $size: bigint = ""
        $id: uuid = ""
        $is_uploaded: Boolean = true
      ) {
        update_storage_files_by_pk(
          pk_columns: { id: $id }
          _set: {
            etag: $etag
            mime_type: $mime_type
            name: $name
            size: $size
            is_uploaded: $is_uploaded
          }
        ) {
          id
          updated_at
          uploaded_by_user_id
          size
          name
          mime_type
          is_uploaded
          etag
          created_at
          bucket_id
        }
      }
    `;

    const variables = {
      id: input.id,
      ...(input.etag ? { etag: input.etag } : {}),
      ...(input.mimeType ? { mime_type: input.mimeType } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
      is_uploaded: input.isUploaded !== undefined ? input.isUploaded : true, // По умолчанию true, если не указано
    };

    this.logger.log(
      `Updating file metadata for ID ${input.id} with fields: ${JSON.stringify(
        variables,
      )}`,
    );

    const data = await this.executeGraphQLRequest(mutation, variables);

    if (!data.update_storage_files_by_pk) {
      throw new NotFoundException(
        `File metadata with ID ${input.id} not found or not accessible for update.`,
      );
    }

    return data.update_storage_files_by_pk;
  }

  async deleteFileMetadata(
    fileId: string,
    userId: string,
    roles?: string[],
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
