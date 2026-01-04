# Инструкция по установке и интеграции (Installation Guide)

Этот документ описывает, как интегрировать Storage Service в существующий проект, в котором уже используются **PostgreSQL**, **Hasura** и **Auth Service** (например, на базе Better Auth).

## Варианты установки

1.  **Shared Schema (Рекомендуемый):** Хранилище использует ту же базу данных и тот же экземпляр Hasura, что и основной проект. Это упрощает настройку связей (Relationships) между файлами и сущностями проекта (например, аватарами пользователей).
2.  **Standalone:** Хранилище работает полностью независимо со своей БД и Hasura. Взаимодействие идет через Remote Schemas или просто по API.

---

## Интеграция по методу Shared Schema

### 1. Накат миграций

Вам необходимо добавить схему `storage` в вашу существующую базу данных.

1.  Скопируйте папку с миграциями из `hasura/migrations/default/` в ваш проект.
2.  Примените миграции:
    ```bash
    hasura migrate apply --endpoint http://your-hasura:8080 --admin-secret your-admin-secret
    ```
3.  (Опционально) Примените сиды для создания начального бакета:
    ```bash
    hasura seed apply --file 1751233854309_initial_buckets.sql
    ```

### 2. Настройка метаданных Hasura

Чтобы Hasura "увидела" новые таблицы и применяла правила доступа:

1.  **Track Tables:** В консоли Hasura или через CLI отследите таблицы `storage.buckets` и `storage.files`.
2.  **Permissions:** Скопируйте настройки прав доступа из `hasura/metadata/databases/default/tables/`. Основные правила:
    - `user`: может видеть и удалять только свои файлы (`uploaded_by_user_id == X-Hasura-User-Id`).
    - `anonymous`: может только читать файлы (если настроено).
3.  **Relationships:** Создайте связь между вашей таблицей пользователей и `storage.files`:
    - `storage.files.uploaded_by_user_id` -> `public.users.id`.

### 3. Добавление контейнера в Docker Compose

Добавьте сервис `storage` в ваш `docker-compose.yaml`. Он будет выступать в роли прокси-сервиса для работы с S3.

```yaml
services:
  # ... ваши существующие сервисы (postgres, hasura, auth) ...

  storage:
    image: aavainshtein/storage-service-backend:latest # Или соберите локально
    restart: always
    environment:
      PORT: 3001
      # Связь с Hasura
      HASURA_GRAPHQL_ENDPOINT: http://hasura:8080/v1/graphql
      HASURA_GRAPHQL_ADMIN_SECRET: ${HASURA_GRAPHQL_ADMIN_SECRET}

      # Связь с Auth (для проверки сессий)
      # Backend будет дергать http://auth:3000/hasura
      BETTER_AUTH_API_URL: http://auth:3000

      # Связь с MinIO / S3
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}
      MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      MINIO_USE_SSL: "false"
      MINIO_DEFAULT_BUCKET_NAME: constante-storage
    depends_on:
      - postgres
      - hasura
      - minio
```

### 4. Настройка переменных окружения

Убедитесь, что в вашем `.env` файле установлены корректные значения для MinIO и Hasura.

**Важно:** `BETTER_AUTH_API_URL` должен указывать на внутренний адрес вашего Auth-сервиса в сети Docker, чтобы `AuthGuard` мог валидировать сессии.

---

## Что это дает?

После такой установки вы получаете:

1.  **Единую точку входа для файлов:** Все загрузки идут через `storage:3001/storage/upload`.
2.  **Автоматический RBAC:** Вам не нужно писать логику проверки прав в коде — Hasura сама проверит, может ли пользователь `X` удалить файл `Y`.
3.  **Связи в GraphQL:** Вы сможете одним запросом получить пользователя и все его файлы:
    ```graphql
    query {
      users_by_pk(id: "...") {
        name
        files {
          # Связь, которую вы создали в шаге 2
          id
          name
          url
        }
      }
    }
    ```
