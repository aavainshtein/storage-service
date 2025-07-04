## Storage-Service (Minio + NestJS + Hasura)

<details>
<summary>English Description</summary>

## Project Overview

This project is a self-hosted file management solution, consisting of two key components:

1. **Backend service in TypeScript (NestJS):** The central hub that handles all file operations. It interacts with **MinIO** for actual file storage, **PostgreSQL** for file metadata, and **Hasura GraphQL Engine** for role-based permission checks.
2. **Client-side JavaScript/TypeScript library (SDK):** An interface for frontend applications, providing convenient methods for interacting with the backend service (uploading, downloading, deleting files, and managing URLs).

The solution focuses on **session authentication via cookies** as the primary mechanism, but also supports **JWT-based authentication** for additional flexibility. Both approaches leverage Hasura's powerful permission system.

> ⚠️ The project is currently in its early stages. This description reflects the intended result.

</details>

<details>
<summary>Описание на русском</summary>

## Обзор Проекта

Этот проект представляет собой комплексное решение для управления файлами, предназначенное для самостоятельного размещения. Оно состоит из двух ключевых компонентов:

1. **Бэкенд-сервис на TypeScript (NestJS):** Центральный хаб, обрабатывающий все операции с файлами. Он взаимодействует с **MinIO** для фактического хранения файлов, **PostgreSQL** для метаданных файлов и **Hasura GraphQL Engine** для проверки разрешений на основе ролей пользователя.
2. **Клиентская JavaScript/TypeScript библиотека (SDK):** Интерфейс для фронтенд-приложений, предоставляющий удобные методы для взаимодействия с бэкенд-сервисом (загрузка, скачивание, удаление файлов и управление URL).

Решение сфокусировано на **сессионной аутентификации через куки** как основном механизме, но также предусматривает возможность **аутентификации с использованием JWT** для дополнительной гибкости. Оба подхода используют мощную систему разрешений Hasura.

> ⚠️ Сейчас проект находится на начальном этапе разработки. Описание отражает желаемый результат.

</details>
