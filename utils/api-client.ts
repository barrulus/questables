const ENV_VAR_NAME = "VITE_DATABASE_SERVER_URL";
export const AUTH_LOGOUT_EVENT = "questables:auth:logout";

function normalizeBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  return trimmed.replace(/\/+$/, "");
}

export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function broadcastAuthLogout(detail: { message: string }) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT, { detail }));
}

export function getApiBaseUrl(): string {
  const envValue = (import.meta.env.VITE_DATABASE_SERVER_URL ?? undefined) as string | undefined;

  if (!envValue || !envValue.trim()) {
    throw new Error(
      `${ENV_VAR_NAME} is not configured. Set it to the fully qualified URL of the database server (e.g., https://localhost:3001).`
    );
  }

  const normalized = normalizeBaseUrl(envValue);
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`${ENV_VAR_NAME} must include the http(s) protocol (received "${envValue}").`);
  }

  return normalized;
}

export function buildApiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`API paths must start with '/'. Received: ${path}`);
  }

  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${path}`;
}

function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem("dnd-auth-token");
  } catch (error) {
    console.warn("[api-client] Unable to read auth token from storage", error);
    return null;
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = buildApiUrl(path);
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const token = headers.has("Authorization") ? null : getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });

  return response;
}

export async function readJsonBody<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    const message = text.trim() || `Unexpected response format (status ${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const clone = response.clone();
    const contentType = clone.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = await clone.json();
      if (payload && typeof payload === "object") {
        const candidate = (payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).message;
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate;
        }
      }
    } else {
      const text = await clone.text();
      if (text.trim()) {
        return text.trim();
      }
    }
  } catch (error) {
    console.error("[api-client] Failed to parse error response", error);
  }

  return `${fallback} (status ${response.status})`;
}

export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  errorMessage?: string,
): Promise<T | undefined> {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      errorMessage ?? "Request failed",
    );
    if (response.status === 401) {
      broadcastAuthLogout({ message });
    }
    throw new HttpError(message, response.status);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined;
  }

  return readJsonBody<T>(response);
}
