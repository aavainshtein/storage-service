-- Создаем схему storage, если она еще не существует
CREATE SCHEMA IF NOT EXISTS storage;

-- Таблица для бакетов
CREATE TABLE IF NOT EXISTS storage.buckets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    min_upload_size BIGINT,
    max_upload_size BIGINT,
    allowed_mime_types JSONB,
    cache_control TEXT,
    download_expiration INTEGER,
    presigned_urls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Таблица для файлов
CREATE TABLE IF NOT EXISTS storage.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    bucket_id UUID NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
    size BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    etag TEXT,
    uploaded_by_user_id TEXT, -- Используем TEXT, так как UUID может быть строкой из вашей системы аутентификации
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Добавляем индексы для повышения производительности
CREATE INDEX IF NOT EXISTS files_bucket_id_idx ON storage.files(bucket_id);
CREATE INDEX IF NOT EXISTS files_uploaded_by_user_id_idx ON storage.files(uploaded_by_user_id);
CREATE INDEX IF NOT EXISTS buckets_name_idx ON storage.buckets(name);

-- Триггеры для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_buckets_updated_at
BEFORE UPDATE ON storage.buckets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at
BEFORE UPDATE ON storage.files
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();