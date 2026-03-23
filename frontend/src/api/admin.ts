import api from "./client";

export interface StorageStats {
  upload_dir: string;
  total_files: number;
  total_size_mb: number;
  personal_files: number;
  personal_size_mb: number;
  shared_files: number;
  shared_size_mb: number;
  orphaned_personal: number;
  orphaned_personal_size_mb: number;
  orphaned_shared: number;
  orphaned_shared_size_mb: number;
}

export interface CleanupResult {
  deleted_files: number;
  freed_mb: number;
  errors: string[];
}

export async function getStorageStats(): Promise<StorageStats> {
  const res = await api.get<StorageStats>("/api/admin/storage");
  return res.data;
}

export async function cleanupStorage(): Promise<CleanupResult> {
  const res = await api.post<CleanupResult>("/api/admin/cleanup-storage");
  return res.data;
}
