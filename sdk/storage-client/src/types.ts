export interface StorageClientConfig {
  baseUrl: string;
  adminSecret?: string;
  accessToken?: string;
}

export interface UploadOptions {
  bucket: string;
  name?: string;
  mimeType?: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  bucket_id: string;
  size: number;
  mime_type: string;
  etag: string;
  uploaded_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DownloadOptions {
  expiresIn?: number;
}
