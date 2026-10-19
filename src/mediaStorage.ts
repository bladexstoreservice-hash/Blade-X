import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ============================================================
// Persistent media storage: <project>/data/media-show/<postId>/<file>
//
// Design notes (VPS-safe):
//   - Root resolved relative to process.cwd() so it works on Windows and Linux.
//   - Files are stored with RELATIVE paths in DB (e.g. "89/image.png"),
//     so the DB is portable across machines.
//   - Writes are atomic (temp + rename) to avoid partial files on crash.
//   - Retention/cleanup is handled by cleanupMediaStorage() — never per-request.
//
// Backup guidance:
//   - Include data/bladex.db AND data/media-show/ in backups.
//   - Both are required to restore View All for existing posts.
// ============================================================
const ROOT = path.resolve(process.cwd(), 'data', 'media-show');

function ensureRoot(): void {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

export function getStorageRoot(): string {
  return ROOT;
}

export function getPostFolder(postId: number): string {
  ensureRoot();
  const folder = path.join(ROOT, String(postId));
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return folder;
}

export function sanitizeFileName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return safe || 'media.bin';
}

export interface SavedMediaFile {
  fileName: string;
  // ✅ Relative to media-show root, e.g. "89/image.png". Portable across OSes.
  filePath: string;
  size: number;
}

export function saveMediaBuffer(
  postId: number,
  fileName: string,
  buffer: Buffer,
): SavedMediaFile | null {
  try {
    const folder = getPostFolder(postId);
    const safeName = sanitizeFileName(fileName);
    const fullPath = path.join(folder, safeName);
    const tmpName = `${safeName}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    const tmpPath = path.join(folder, tmpName);

    // Atomic write: open temp → write → fsync (best-effort) → rename.
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, buffer);
      try { fs.fsyncSync(fd); } catch { /* fsync not supported on some FS */ }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, fullPath);

    return {
      fileName: safeName,
      filePath: `${postId}/${safeName}`, // ✅ relative
      size: buffer.length,
    };
  } catch (e) {
    console.error(`[Blade X][storage] save_failed postId=${postId} name=${fileName}`, e);
    return null;
  }
}

/**
 * Accepts both relative ("89/image.png") and absolute paths (legacy).
 * Legacy Windows-absolute paths that don't exist on Linux are recovered by
 * extracting the basename and retrying under data/media-show/<anyPostId>/.
 */
function resolveMediaPath(filePath: string): string | null {
  if (!filePath) return null;

  if (path.isAbsolute(filePath)) {
    if (fs.existsSync(filePath)) return filePath;
    // Legacy path: try to recover by basename under ROOT.
    const base = path.basename(filePath);
    if (base && base !== filePath) {
      try {
        const entries = fs.readdirSync(ROOT, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const candidate = path.join(ROOT, e.name, base);
          if (fs.existsSync(candidate)) return candidate;
        }
      } catch { /* ignore */ }
    }
    return filePath; // let caller fail cleanly
  }

  // Relative path — resolve under ROOT.
  return path.resolve(ROOT, filePath);
}

export function readMediaFile(filePath: string): Buffer | null {
  try {
    const resolved = resolveMediaPath(filePath);
    if (!resolved || !fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved);
  } catch (e) {
    console.warn(`[Blade X][storage] read_failed path=${filePath}`, e);
    return null;
  }
}

export function deleteMediaForPost(postId: number): void {
  try {
    const folder = path.join(ROOT, String(postId));
    if (fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true });
      console.log(`[Blade X][storage] deleted postId=${postId}`);
    }
  } catch (e) {
    console.warn(`[Blade X][storage] delete_failed postId=${postId}`, e);
  }
}

export function fileExists(filePath: string): boolean {
  try {
    const resolved = resolveMediaPath(filePath);
    return !!resolved && fs.existsSync(resolved);
  } catch { return false; }
}

// ============================================================
// Usage stats
// ============================================================
export function getStorageUsage(): { totalBytes: number; fileCount: number; postCount: number } {
  ensureRoot();
  let totalBytes = 0;
  let fileCount = 0;
  let postCount = 0;
  try {
    const entries = fs.readdirSync(ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      postCount++;
      const folder = path.join(ROOT, entry.name);
      try {
        const files = fs.readdirSync(folder, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile()) continue;
          try {
            const st = fs.statSync(path.join(folder, f.name));
            totalBytes += st.size;
            fileCount++;
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { totalBytes, fileCount, postCount };
}

// ============================================================
// Retention / cleanup
// ============================================================
export interface RetentionPolicy {
  maxTotalBytes: number | null;
  maxAgeMs: number | null;
  maxPosts: number | null;
}

export interface CleanupResult {
  removedFiles: number;
  removedPosts: number;
  freedBytes: number;
  reason: string;
  ranAt: number;
}

/**
 * Deletes disk files (and their folders) for posts that exceed retention.
 * Does NOT touch the DB — the caller is responsible for deleting media_files
 * rows for removed posts (or the getMediaForPost fallback handles them).
 */
export function cleanupMediaStorage(policy: RetentionPolicy): CleanupResult {
  ensureRoot();
  const result: CleanupResult = {
    removedFiles: 0,
    removedPosts: 0,
    freedBytes: 0,
    reason: '',
    ranAt: Date.now(),
  };

  interface PostEntry { postId: number; folder: string; size: number; mtime: number; }
  const posts: PostEntry[] = [];

  try {
    const entries = fs.readdirSync(ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const postId = Number(entry.name);
      if (!Number.isInteger(postId)) continue;
      const folder = path.join(ROOT, entry.name);
      let size = 0;
      let mtime = 0;
      let fileCount = 0;
      try {
        const files = fs.readdirSync(folder, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile()) continue;
          try {
            const st = fs.statSync(path.join(folder, f.name));
            size += st.size;
            if (st.mtimeMs > mtime) mtime = st.mtimeMs;
            fileCount++;
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      posts.push({ postId, folder, size, mtime });
      // Stash fileCount on a private field for accurate bookkeeping
      (posts[posts.length - 1] as any).fileCount = fileCount;
    }
  } catch (e) {
    result.reason = `readdir_failed: ${(e as Error)?.message ?? 'unknown'}`;
    return result;
  }

  // 1) Age-based cleanup
  if (policy.maxAgeMs !== null && policy.maxAgeMs > 0) {
    const cutoff = Date.now() - policy.maxAgeMs;
    for (const p of posts) {
      if (p.mtime > 0 && p.mtime < cutoff) {
        try {
          const fc = (p as any).fileCount ?? 1;
          fs.rmSync(p.folder, { recursive: true, force: true });
          result.removedPosts++;
          result.removedFiles += fc;
          result.freedBytes += p.size;
          p.size = 0;
          (p as any).fileCount = 0;
        } catch { /* ignore */ }
      }
    }
    if (result.removedPosts > 0) result.reason = 'age';
  }

  // 2) Recompute remaining posts, oldest first
  const remaining = posts.filter(p => p.size > 0).sort((a, b) => a.mtime - b.mtime);

  // 3) Total size cap
  if (policy.maxTotalBytes !== null && policy.maxTotalBytes > 0) {
    let total = remaining.reduce((s, p) => s + p.size, 0);
    while (total > policy.maxTotalBytes && remaining.length > 0) {
      const oldest = remaining.shift()!;
      try {
        const fc = (oldest as any).fileCount ?? 1;
        fs.rmSync(oldest.folder, { recursive: true, force: true });
        total -= oldest.size;
        result.removedPosts++;
        result.removedFiles += fc;
        result.freedBytes += oldest.size;
        result.reason = result.reason ? `${result.reason}+size` : 'size';
      } catch { /* ignore */ }
    }
  }

  // 4) Post-count cap
  if (policy.maxPosts !== null && policy.maxPosts > 0) {
    while (remaining.length > policy.maxPosts) {
      const oldest = remaining.shift()!;
      try {
        const fc = (oldest as any).fileCount ?? 1;
        fs.rmSync(oldest.folder, { recursive: true, force: true });
        result.removedPosts++;
        result.removedFiles += fc;
        result.freedBytes += oldest.size;
        result.reason = result.reason ? `${result.reason}+count` : 'count';
      } catch { /* ignore */ }
    }
  }

  return result;
}