import { z } from "zod";
import { EMAIL_RE } from "@projective/types/auth";
import { isIdentifier } from "./validate.ts";

/**
 * Zod request schemas for the auth API routes (SYSTEM_ARCHITECTURE.md §Security — every API handler
 * Zod-validates the body before touching a Service). The `/join` body is the SSOT in
 * `@projective/types/auth` and is re-exported here so every auth route imports from one place. Only
 * regex/min/max/enum/literal primitives are used so the schema is stable across Zod majors.
 */

export { IndividualJoinSchema, JoinSchema, EnterpriseJoinSchema } from "@projective/types/auth";

const email = z.string().trim().regex(EMAIL_RE, "Enter a valid email address.");
const password = z.string().min(8, "Use at least 8 characters.").max(128);
const redirectTo = z.string().default("/home");

/**
 * Password sign-in. `identifier` is an email OR a username in one field — the predicate is
 * {@link isIdentifier}, the same one the form's instant check runs, so a value the form accepts is a
 * value the route accepts. Which of the two it is, and the username → email resolution, belong to the
 * fat service; the route never inspects it.
 */
export const LoginSchema = z.object({
	identifier: z.string().trim().min(1, "Email or username is required.").max(254).refine(
		isIdentifier,
		"Enter a valid email address or username.",
	),
	password: z.string().min(1, "Password is required."),
	remember: z.boolean().default(false),
	redirectTo,
});

/** Enterprise SSO domain lookup — resolves a corporate email domain to its SAML/OIDC IdP. */
export const SsoSchema = z.object({
	domain: z.string().trim().min(3).max(120).regex(
		/^[a-z0-9.-]+\.[a-z]{2,}$/i,
		"Enter a domain like company.com.",
	),
	redirectTo,
});

export const ForgotPasswordSchema = z.object({ email, redirectTo });

export const ResetPasswordSchema = z.object({
	email,
	code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
	password,
	redirectTo,
});

export const VerifySchema = z.object({
	email: email.optional(),
	code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
	redirectTo,
});

export const ResendSchema = z.object({ email: email.optional() });

export const ConfirmLinkSchema = z.object({
	token_hash: z.string().regex(/^[0-9a-f]{20,128}$/i),
	type: z.literal("email"),
});

/** Flatten a Zod error into a `{ "path.to.field": message }` record for `AuthResult.errors`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
	const out: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.join(".") || "form";
		if (!out[key]) out[key] = issue.message;
	}
	return out;
}
