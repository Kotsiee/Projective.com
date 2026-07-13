import { z } from "zod";
import { EMAIL_RE, PHONE_RE, USERNAME_RE } from "./validate.ts";
import { EMPLOYEE_TIERS, INDUSTRIES } from "./options.ts";

/**
 * Zod request schemas for the auth API routes (SYSTEM_ARCHITECTURE.md §Security — every API handler
 * Zod-validates the body before touching a Service). Kept in the feature for now; migrates to
 * `@projective/types` with Supabase. Only regex/min/max/enum/literal primitives are used so the
 * schema is stable across Zod majors.
 */

const email = z.string().trim().regex(EMAIL_RE, "Enter a valid email address.");
const password = z.string().min(8, "Use at least 8 characters.").max(128);
const name = z.string().trim().min(1).max(60);
const redirectTo = z.string().default("/home");
const strList = z.array(z.string().trim().min(1).max(60)).max(50).default([]);

const employeeValues = EMPLOYEE_TIERS.map((t) => t.value) as [string, ...string[]];
const industryValues = INDUSTRIES.map((i) => i.value) as [string, ...string[]];

/**
 * Individual (quick) onboarding. `password` is optional because SSO/OAuth signups skip password
 * setup (`oauth: true`); the join handler requires it only when `oauth` is false. `restricted` is
 * re-derived server-side from `dob`, never trusted.
 */
export const IndividualJoinSchema = z.object({
	type: z.literal("individual"),
	intent: z.enum(["client", "freelancer"]),
	email,
	password: z.string().max(128).optional(),
	oauth: z.boolean().default(false),
	firstName: name,
	lastName: name,
	username: z.string().trim().regex(USERNAME_RE, "Invalid username."),
	dob: z.string().min(1, "Date of birth is required."),
	purpose: z.array(z.string().max(40)).max(20).default([]),
	skills: z.array(z.string().max(40)).max(50).default([]),
	redirectTo,
});

/**
 * Organization (comprehensive, multi-step) onboarding. Organizations are **client/buyer-only** on
 * Projective (they hire, they don't sell), so `intent` is pinned to `client`. `website` is the
 * optional corporate web footprint.
 */
export const OrganizationJoinSchema = z.object({
	type: z.literal("organization"),
	intent: z.literal("client").default("client"),
	legalName: name,
	tradingName: z.string().trim().max(120).default(""),
	handle: z.string().trim().max(40).default(""),
	registrationNumber: z.string().trim().max(60).default(""),
	website: z.string().trim().max(200).default(""),
	corporateEmail: email,
	phone: z.string().trim().regex(PHONE_RE, "Enter a valid phone number."),
	address: z.object({
		street: z.string().trim().min(1).max(160),
		city: z.string().trim().min(1).max(80),
		postcode: z.string().trim().min(1).max(20),
		country: z.string().trim().min(1).max(60),
	}),
	employeeTier: z.enum(employeeValues),
	industry: z.enum(industryValues),
	departments: strList,
	purpose: z.array(z.string().max(40)).max(20).default([]),
	password,
	redirectTo,
});

/** Discriminated on `type` so one endpoint validates either onboarding shape. */
export const JoinSchema = z.discriminatedUnion("type", [
	IndividualJoinSchema,
	OrganizationJoinSchema,
]);

export const LoginSchema = z.object({
	email,
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

/** Flatten a Zod error into a `{ "path.to.field": message }` record for `AuthResult.errors`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
	const out: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.join(".") || "form";
		if (!out[key]) out[key] = issue.message;
	}
	return out;
}
