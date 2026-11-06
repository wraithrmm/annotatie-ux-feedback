// capture-design.md §7: each file goes straight to S3 with its presigned POST policy; then the widget
// confirms each uploaded file's size and SHA-256. A file that fails is dropped (and noted) — the report
// itself has already been sent.
import type { CaptureFile } from "@annotatie/core";
import { postToPolicy, type Api, type UploadPolicy } from "./api.js";
import { sha256Hex } from "./capture/render.js";

const FILENAMES: Record<CaptureFile, string> = {
  page: "page.webp",
  pageMarked: "page-marked.webp",
  closeup: "closeup.webp",
  html: "page.html.gz",
};

export interface UploadResult {
  confirmed: CaptureFile[];
  dropped: CaptureFile[];
}

export async function uploadCapture(
  api: Api,
  itemId: string,
  uploads: Partial<Record<CaptureFile, UploadPolicy>>,
  files: Partial<Record<CaptureFile, Blob>>,
  fetchFn?: typeof fetch,
): Promise<UploadResult> {
  const done: Partial<Record<CaptureFile, { size: number; sha256: string }>> = {};
  const dropped: CaptureFile[] = [];
  await Promise.all(
    (Object.keys(files) as CaptureFile[]).map(async (name) => {
      const blob = files[name]!;
      const policy = uploads[name];
      if (!policy) {
        dropped.push(name);
        return;
      }
      try {
        const sha256 = await sha256Hex(blob);
        await postToPolicy(policy, blob, FILENAMES[name], fetchFn);
        done[name] = { size: blob.size, sha256 };
      } catch {
        dropped.push(name);
      }
    }),
  );
  const confirmed = Object.keys(done) as CaptureFile[];
  if (confirmed.length) {
    try {
      await api.confirmCapture(itemId, done);
    } catch {
      return { confirmed: [], dropped: [...dropped, ...confirmed] };
    }
  }
  return { confirmed, dropped };
}
