import { getBackendBaseUrl } from "@/lib/backend";

export type ApiError = {
  detail?: string;
  error?: string;
};

async function authedFetch<T>(args: {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string;
  body?: unknown;
  signal?: AbortSignal;
}): Promise<T> {
  const backendBaseUrl = getBackendBaseUrl();
  const url = `${backendBaseUrl}${args.path}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (args.token) headers.Authorization = `Bearer ${args.token}`;

  let body: BodyInit | undefined = undefined;
  if (args.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(args.body);
  }

  const res = await fetch(url, {
    method: args.method,
    headers,
    body,
    signal: args.signal,
  });

  if (!res.ok) {
    let payload: ApiError | string = "";
    try {
      payload = await res.json();
    } catch {
      payload = await res.text();
    }

    const detail = typeof payload === "string" ? payload : payload.detail || payload.error;
    throw new Error(`API ${args.method} ${args.path} failed (${res.status}): ${detail || "Unknown error"}`);
  }

  // Some endpoints may return empty objects
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export type JwtProvider = () => Promise<string>;

export async function makeAuthedClient<TToken extends JwtProvider>(getToken: TToken) {
  return {
    async get<R>(path: string) {
      const token = await getToken();
      return authedFetch<R>({ path, method: "GET", token });
    },
    async post<R>(path: string, body: unknown) {
      const token = await getToken();
      return authedFetch<R>({ path, method: "POST", token, body });
    },
    async patch<R>(path: string, body: unknown) {
      const token = await getToken();
      return authedFetch<R>({ path, method: "PATCH", token, body });
    },
    async del<R>(path: string) {
      const token = await getToken();
      return authedFetch<R>({ path, method: "DELETE", token });
    },
  };
}

