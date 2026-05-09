import { readFile, writeFile, stat } from "node:fs/promises";
import { basename } from "node:path";

export type AtlassianConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
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
  private authHeader: string;

  constructor(cfg: AtlassianConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    const basic = Buffer.from(`${cfg.email}:${cfg.apiToken}`, "utf8").toString("base64");
    this.authHeader = `Basic ${basic}`;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
    // path may already be absolute (e.g. attachment download URL)
    const isAbsolute = /^https?:\/\//.test(path);
    const url = new URL(isAbsolute ? path : this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
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
    const stats = await stat(filePath);
    if (!stats.isFile()) throw new Error(`Not a file: ${filePath}`);
    const buf = await readFile(filePath);
    const filename = opts.filename ?? basename(filePath);

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
   * Download binary content (e.g. an attachment) from any URL or path on the
   * Atlassian instance. Returns metadata and either base64 (if no outputPath)
   * or writes to disk and returns the saved path.
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
    const buf = Buffer.from(await res.arrayBuffer());

    if (opts.outputPath) {
      await writeFile(opts.outputPath, buf);
      return { status: res.status, bytes: buf.byteLength, contentType, outputPath: opts.outputPath };
    }
    return { status: res.status, bytes: buf.byteLength, contentType, base64: buf.toString("base64") };
  }
}

export function loadConfig(): AtlassianConfig {
  const baseUrl = process.env.ATLASSIAN_BASE_URL;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;
  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      "Missing env. Required: ATLASSIAN_BASE_URL (e.g. https://your-org.atlassian.net), ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN",
    );
  }
  return { baseUrl, email, apiToken };
}
