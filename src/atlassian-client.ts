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

  async request<T = unknown>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
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

    if (!res.ok) {
      throw new AtlassianError(res.statusText, res.status, data);
    }
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
  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
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
