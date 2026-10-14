import { z } from "zod";

import { invalidRequest } from "../../protocol.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalStringSchema = NonEmptyStringSchema.nullable().default(null);

export const InstagramCredentialSchema = z.strictObject({
  accessToken: NonEmptyStringSchema,
  accountID: OptionalStringSchema,
  accountUsername: OptionalStringSchema,
  apiVersion: OptionalStringSchema,
});

export type InstagramCredential = z.infer<typeof InstagramCredentialSchema>;

const parseCredential = <T extends z.ZodType>(
  schema: T,
  value: unknown,
  message: string,
): z.infer<T> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalidRequest(message, { issues: result.error.issues });
  }
  return result.data;
};

export const normalizeInstagramCredential = (value: unknown) =>
  parseCredential(
    InstagramCredentialSchema,
    value,
    "Instagram account setup requires a valid credential object.",
  );
