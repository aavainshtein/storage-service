INSERT INTO storage.buckets (id, name, presigned_urls_enabled, created_at, updated_at)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'constante-storage', TRUE, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
