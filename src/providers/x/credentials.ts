import { z } from "zod";

import { invalidRequest } from "../../protocol.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalStringSchema = NonEmptyStringSchema.nullable().default(null);

export const XChatCapabilitiesSchema = z.object({
  supported: z.boolean(),
  passcodeStored: z.boolean(),
  realmAuthMode: z.literal("x-api-token-map"),
  externalIssuerFallbackConfigured: z.boolean(),
});

export const XOAuthClientSchema = z.strictObject({
  clientID: NonEmptyStringSchema,
  clientSecret: OptionalStringSchema,
  clientType: z.enum(["public", "confidential"]),
  redirectURI: z.url(),
  realmTokenIssuerURL: OptionalStringSchema,
});

export const XOAuthCallbackURLSchema = z.strictObject({
  callbackURL: z.url(),
});

export const XOAuthCodeSchema = z.strictObject({
  code: NonEmptyStringSchema,
  state: NonEmptyStringSchema,
});

export const XOAuthCompletionSchema = z.union([
  XOAuthCallbackURLSchema,
  XOAuthCodeSchema,
]);

export const XAccountAddRequestSchema = z.union([
  XOAuthClientSchema,
  XOAuthCallbackURLSchema,
  XOAuthCodeSchema,
]);

export type XOAuthClient = z.infer<typeof XOAuthClientSchema>;
export type XOAuthCompletion = z.infer<typeof XOAuthCompletionSchema>;

export const XCredentialSchema = z.strictObject({
  clientID: NonEmptyStringSchema,
  clientSecret: NonEmptyStringSchema.nullable(),
  clientType: z.enum(["public", "confidential"]),
  redirectURI: z.url(),
  accessToken: NonEmptyStringSchema,
  refreshToken: NonEmptyStringSchema.nullable(),
  expiresAt: z.number().finite(),
  accountUserID: NonEmptyStringSchema,
  accountUsername: NonEmptyStringSchema,
  grantedScopes: z.array(z.string()),
  realmTokenIssuerURL: NonEmptyStringSchema.nullable(),
});

export type XCredential = z.infer<typeof XCredentialSchema>;

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

const requireConfidentialSecret = <T extends XOAuthClient | XCredential>(
  client: T,
) => {
  if (client.clientType === "confidential" && !client.clientSecret) {
    throw invalidRequest("Confidential X clients require clientSecret.");
  }
  return client;
};

export const normalizeXOAuthClient = (value: unknown): XOAuthClient =>
  requireConfidentialSecret(parseCredential(
    XOAuthClientSchema,
    value,
    "X account setup requires a valid OAuth client configuration.",
  ));

export const normalizeXOAuthCompletion = (
  value: unknown,
): XOAuthCompletion =>
  parseCredential(
    XOAuthCompletionSchema,
    value,
    "X OAuth completion requires exactly callbackURL or code and state.",
  );

export const normalizeXCredential = (value: unknown) =>
  requireConfidentialSecret(parseCredential(
    XCredentialSchema,
    value,
    "The stored X credential is invalid.",
  ));
