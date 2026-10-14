import { DmbridgeError } from "../protocol.js";
import { isTimeoutError, timeoutError, timeoutSignal } from "../runtime.js";

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
  mutation?: boolean;
};

const providerMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : null;
  const value = nested?.message ?? record.detail ?? record.title;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

export const requestJSON = async <T>(
  provider: string,
  url: URL | string,
  options: RequestOptions = {},
): Promise<{ data: T; response: Response }> => {
  let response: Response;
  try {
    const request: RequestInit = {
      method: options.method ?? "GET",
      signal: timeoutSignal(options.timeoutMs ?? 30_000),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body ? { body: options.body } : {}),
    };
    response = await fetch(url, request);
  } catch (error) {
    if (isTimeoutError(error)) {
      throw timeoutError(`${provider} request`, Boolean(options.mutation));
    }
    throw new DmbridgeError(
      "provider.networkFailure",
      `${provider} request did not complete.`,
      {
        retrySafety: options.mutation ? "unsafe" : "safe",
        details: { outcomeUnknown: Boolean(options.mutation) },
        exitCode: 5,
        cause: error,
      },
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  if (contentType.includes("json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const rateLimited = response.status === 429;
    throw new DmbridgeError(
      rateLimited ? "provider.rateLimited" : "provider.requestFailed",
      providerMessage(
        payload,
        `${provider} request failed with HTTP ${response.status}.`,
      ),
      {
        retrySafety: options.mutation ? "unsafe" : rateLimited ? "safe" : "never",
        details: {
          httpStatus: response.status,
          retryAfter: response.headers.get("retry-after"),
          outcomeUnknown: Boolean(options.mutation),
        },
        exitCode: 5,
      },
    );
  }
  return { data: payload as T, response };
};

type QueryValue = string | number | boolean | null | undefined;

export class ProviderClient {
  constructor(
    private readonly provider: string,
    private readonly baseURL: string,
    private readonly headers: () => Record<string, string>,
  ) {}

  private url(path: string, query?: Record<string, QueryValue>) {
    const url = new URL(
      path.replace(/^\//, ""),
      this.baseURL.endsWith("/") ? this.baseURL : `${this.baseURL}/`,
    );
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }
    return url;
  }

  async get<T>(path: string, query?: Record<string, QueryValue>) {
    return (
      await requestJSON<T>(this.provider, this.url(path, query), {
        headers: this.headers(),
      })
    ).data;
  }

  async mutate<T>(
    path: string,
    method: "POST" | "DELETE",
    body?: unknown,
  ) {
    return (
      await requestJSON<T>(this.provider, this.url(path), {
        method,
        headers: {
          ...this.headers(),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        mutation: true,
      })
    ).data;
  }
}
