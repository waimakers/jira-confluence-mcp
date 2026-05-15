import { constants } from "node:fs";
import { access, readFile, writeFile, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

export type AtlassianConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

export type FileAccessConfig = {
  fileRoot?: string;
  maxFileBytes?: number;
  allowOverwrite?: boolean;
};

export class AtlassianError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(`Atlassian API ${status}: ${message}`);
    this.name = "AtlassianError";
  }
}

export class AtlassianClient {
  private baseUrl: string;
  private baseOrigin: string;
  private authHeader: string;
  private fileRoot?: string;
  private maxFileBytes: number;
  private allowOverwrite: boolean;

  constructor(cfg: AtlassianConfig, fileAccess: FileAccessConfig = {}) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.baseOrigin = new URL(this.baseUrl).origin;
    const basic = Buffer.from(`${cfg.email}:${cfg.apiToken}`, "utf8").toString("base64");
    this.authHeader = `Basic ${basic}`;
    this.fileRoot = fileAccess.fileRoot ? resolve(fileAccess.fileRoot) : undefined;
    this.maxFileBytes = fileAccess.maxFileBytes ?? 10 * 1024 * 1024;
    this.allowOverwrite = fileAccess.allowOverwrite ?? false;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const isAbsolute = /^https?:\/\//.test(path);
    const url = new URL(isAbsolute ? path : this.baseUrl + path);
    if (url.origin !== this.baseOrigin) {
      throw new Error(`Refusing to send Atlassian credentials to non-Atlassian URL: ${url.origin}`);
    }
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private resolveSafeFilePath(filePath: string): string {
    if (!this.fileRoot) {
      throw new Error("Attachment file access is disabled. Set JCMCP_FILE_ROOT to an allowed directory.");
    }
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(this.fileRoot, filePath);
    const rel = relative(this.fileRoot, resolved);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Refusing file path outside JCMCP_FILE_ROOT: ${filePath}`);
    }
    return resolved;
  }

  private assertFileSize(bytes: number): void {
    if (bytes > this.maxFileBytes) {
      throw new Error(`File is too large (${bytes} bytes). Limit is ${this.maxFileBytes} bytes.`);
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(this.buildUrl(path, opts.query), {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // not JSON — keep as text
      }
    }

    if (!res.ok) throw new AtlassianError(res.statusText, res.status, data);
    return data as T;
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    return this.request<T>("GET", path, { query });
  }
  post<T = unknown>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>) {
    return this.request<T>("POST", path, { body, query });
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body });
  }
  delete<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    return this.request<T>("DELETE", path, { query });
  }

  /**
   * Upload a local file as multipart/form-data attachment.
   * Used for both Jira (`/rest/api/3/issue/{key}/attachments`) and
   * Confluence v1 (`/wiki/rest/api/content/{id}/child/attachment`).
   */
  async uploadFile<T = unknown>(
    path: string,
    filePath: string,
    opts: { filename?: string; comment?: string; minorEdit?: boolean } = {},
  ): Promise<T> {
    const safeFilePath = this.resolveSafeFilePath(filePath);
    const stats = await stat(safeFilePath);
    if (!stats.isFile()) throw new Error(`Not a file: ${filePath}`);
    this.assertFileSize(stats.size);
    const buf = await readFile(safeFilePath);
    const filename = opts.filename ?? basename(safeFilePath);

    const form = new FormData();
    const blob = new Blob([buf]);
    form.append("file", blob, filename);
    if (opts.comment) form.append("comment", opts.comment);
    if (opts.minorEdit !== undefined) form.append("minorEdit", String(opts.minorEdit));

    const res = await fetch(this.buildUrl(path), {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        // Required by Atlassian for multipart uploads (CSRF protection bypass)
        "X-Atlassian-Token": "no-check",
      },
      body: form,
    });

    const text = await res.text();
    let data: unknown = text;
    if (text) {
      try { data = JSON.parse(text); } catch { /* keep as text */ }
    }
    if (!res.ok) throw new AtlassianError(res.statusText, res.status, data);
    return data as T;
  }

  /**
   * Download binary content (e.g. an attachment) from the configured Atlassian
   * instance. Returns metadata and either base64 (if no outputPath) or writes
   * to JCMCP_FILE_ROOT and returns the saved path.
   */
  async downloadBinary(
    pathOrUrl: string,
    opts: { outputPath?: string } = {},
  ): Promise<{ status: number; bytes: number; contentType: string; outputPath?: string; base64?: string }> {
    const res = await fetch(this.buildUrl(pathOrUrl), {
      method: "GET",
      headers: { Authorization: this.authHeader },
      // Atlassian redirects /attachment/content/{id} to a signed CDN URL.
      redirect: "follow",
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new AtlassianError(res.statusText, res.status, errText);
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = res.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength)) this.assertFileSize(Number(contentLength));

    const buf = Buffer.from(await res.arrayBuffer());
    this.assertFileSize(buf.byteLength);

    if (opts.outputPath) {
      const outputPath = this.resolveSafeFilePath(opts.outputPath);
      if (!this.allowOverwrite) {
        try {
          await access(outputPath, constants.F_OK);
          throw new Error(`Refusing to overwrite existing file: ${outputPath}`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      await writeFile(outputPath, buf, { flag: this.allowOverwrite ? "w" : "wx" });
      return { status: res.status, bytes: buf.byteLength, contentType, outputPath };
    }
    return { status: res.status, bytes: buf.byteLength, contentType, base64: buf.toString("base64") };
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AtlassianConfig {
  const baseUrl = env.ATLASSIAN_BASE_URL;
  const email = env.ATLASSIAN_EMAIL;
  const apiToken = env.ATLASSIAN_API_TOKEN;
  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      "Missing env. Required: ATLASSIAN_BASE_URL (e.g. https://your-org.atlassian.net), ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN",
    );
  }

  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.protocol !== "https:") {
    throw new Error("ATLASSIAN_BASE_URL must use https");
  }
  if (
    !parsedBaseUrl.hostname.endsWith(".atlassian.net") &&
    env.JCMCP_ALLOW_NON_ATLASSIAN_BASE_URL !== "true"
  ) {
    throw new Error("ATLASSIAN_BASE_URL must be an atlassian.net host unless JCMCP_ALLOW_NON_ATLASSIAN_BASE_URL=true");
  }

  return { baseUrl: parsedBaseUrl.origin, email, apiToken };
}
