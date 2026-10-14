export type JsonRecord = Record<string, unknown>;

export const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const compactMap = <T, U>(
  values: Iterable<T>,
  normalize: (value: T) => U | null,
) => {
  const result: U[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized !== null) result.push(normalized);
  }
  return result;
};

export const string = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const id = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim() || null
    : null;

export const boolean = (value: unknown) =>
  typeof value === "boolean" ? value : null;

export const isoTime = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

export const httpsURL = (value: unknown) => {
  const candidate = string(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};
