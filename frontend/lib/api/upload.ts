import apiClient from "./client";
import type { UploadResponse } from "@/types/api";

export async function uploadFile(
  file: File,
  module: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("module", module);

  const { data } = await apiClient.post<UploadResponse>(
    "/api/v1/upload",
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 300_000, // 5 min for large uploads
      signal,
      onUploadProgress: (e) => {
        if (e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    }
  );
  return data;
}
