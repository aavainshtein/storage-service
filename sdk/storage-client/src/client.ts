import {
  StorageClientConfig,
  UploadOptions,
  FileMetadata,
  DownloadOptions,
} from "./types";

export class StorageClient {
  private baseUrl: string;
  private adminSecret?: string;
  private accessToken?: string;

  constructor(config: StorageClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.adminSecret = config.adminSecret;
    this.accessToken = config.accessToken;
  }

  /**
   * Update the access token for subsequent requests
   */
  setAccessToken(token: string) {
    this.accessToken = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.adminSecret) {
      headers["x-hasura-admin-secret"] = this.adminSecret;
    } else if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /**
   * Upload a file to a specific bucket
   */
  async upload(
    file: File | Blob | any,
    options: UploadOptions
  ): Promise<FileMetadata> {
    const formData = new FormData();

    // In Node.js, if 'file' is a Buffer, we should wrap it in a Blob
    let fileToUpload = file;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(file)) {
      fileToUpload = new Blob([new Uint8Array(file)], {
        type: options.mimeType || "application/octet-stream",
      });
    }

    formData.append("file", fileToUpload, options.name);
    formData.append("bucket", options.bucket);

    const response = await fetch(`${this.baseUrl}/storage/upload`, {
      method: "POST",
      headers: this.getHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(`Upload failed: ${error.message || response.statusText}`);
    }

    const data = await response.json();
    return data.updatedFileMetadata;
  }

  /**
   * Get file metadata by ID
   */
  async getMetadata(fileId: string): Promise<FileMetadata> {
    const response = await fetch(`${this.baseUrl}/storage/${fileId}/metadata`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(
        `Failed to fetch metadata: ${error.message || response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get a direct link to the file through the storage service (proxy).
   * This link is "eternal" but requires authentication (cookie or header).
   */
  getDownloadUrl(fileId: string): string {
    return `${this.baseUrl}/storage/download/${fileId}`;
  }

  /**
   * Get a temporary presigned URL directly to the S3 storage.
   * This URL is public and expires after a certain time.
   */
  async getPresignedUrl(
    fileId: string,
    options?: DownloadOptions
  ): Promise<string> {
    const query = options?.expiresIn ? `?expiry=${options.expiresIn}` : "";
    const response = await fetch(
      `${this.baseUrl}/storage/presigned-url/${fileId}${query}`,
      {
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(
        `Failed to get presigned URL: ${error.message || response.statusText}`
      );
    }

    const data = await response.json();
    return data.url;
  }

  /**
   * Download a file and return its content as a Blob.
   * Works in both Browser and Node.js (18+).
   */
  async download(fileId: string): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/storage/download/${fileId}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(
        `Download failed: ${error.message || response.statusText}`
      );
    }

    return response.blob();
  }

  /**
   * Delete a file by ID
   */
  async delete(fileId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/storage/${fileId}`, {
      method: "DELETE",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(`Delete failed: ${error.message || response.statusText}`);
    }
  }
}
