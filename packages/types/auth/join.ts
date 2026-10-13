import { z } from "zod";
import { isDisplayCurrency } from "../finance/fx.ts";
import { toSupportedLocale } from "../org/locales.ts";
import { bracketFromDob, isTimeZone, UNDER_MINIMUM_REFUSAL } from "./age.ts";

/**
 * auth/join — the Zod SSOT for the `/join` request body (SYSTEM_ARCHITECTURE.md §Security: every API
 * handler Zod-validates the body before touching a service). The `/api/auth/join` route parses it,
 * `AuthBackendService.provisionAccount` receives the parsed shape, and the islands' instant checks
 * read the same patterns so a value the form accepts is a value the route accepts.
 *
 * Only regex/min/max/enum/literal primitives are used so the schema is stable across Zod majors
 * (matching `@projective/types/org`).
 */

// #region Patterns
/** Pragmatic email shape check (authoritative verification happens via the emailed link/code). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Handles/usernames: 3–30 chars, must start with a letter, then letters, numbers, or the permitted
 * separators `.`, `-`, `_`. Anything the app's `sanitizeHandle` produces must pass this test.
 */
export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,29}$/i;
/** Loose international phone shape: optional +, digits, spaces, dashes, parens. */
export const PHONE_RE = /^[+]?[()\d\s-]{7,20}$/;
/** An ISO calendar date as a native `<input type="date">` submits it. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// #endregion

// #region Option values
/** Organization headcount tiers; the app's `EMPLOYEE_TIERS` labels these values. */
export const EMPLOYEE_TIER_VALUES = ["1-50", "51-200", "201-500", "500+"] as const;
export type EmployeeTier = typeof EMPLOYEE_TIER_VALUES[number];

/** Organization primary industries (`other` is the catch-all); the app's `INDUSTRIES` labels these. */
export const INDUSTRY_VALUES = [
	"software",
	"design",
	"marketing",
	"finance",
	"ecommerce",
	"media",
	"education",
	"healthcare",
	"manufacturing",
	"nonprofit",
	"other",
] as const;
export type Industry = typeof INDUSTRY_VALUES[number];
// #endregion

// #region Schemas
const email = z.string().trim().regex(EMAIL_RE, "Enter a valid email address.");
const password = z.string().min(8, "Use at least 8 characters.").max(128);
const name = z.string().trim().min(1).max(60);
const redirectTo = z.string().default("/home");
const strList = z.array(z.string().trim().min(1).max(60)).max(50).default([]);

/**
 * The browser's formatting preferences, sent as hints for the new account's settings (Decision
 * #207): an unsupported value is dropped, never refused, and the account keeps the default.
 */
const locale = z.string().trim().max(35).optional().transform((tag) => toSupportedLocale(tag));
const displayCurrency = z.string().trim().max(3).optional().transform((code) =>
	isDisplayCurrency(code) ? code?.toUpperCase() : undefined
);

const dob = z.string().min(1, "Date of birth is required.").regex(
	ISO_DATE_RE,
	"Enter a real date of birth.",
);

/**
 * Individual (quick) onboarding. `password` is optional because SSO/OAuth signups skip password
 * setup (`oauth: true`); the service requires it only when `oauth` is false.
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
	dob,
	/**
	 * The browser's IANA zone. Stored as the profile's `timezone`, it is the zone every layer counts
	 * this person's birthdays in; an unknown one is dropped and the age counts in UTC.
	 */
	timeZone: z.string().trim().max(64).optional().transform((zone) =>
		isTimeZone(zone) ? zone : undefined
	),
	locale,
	displayCurrency,
	purpose: z.array(z.string().max(40)).max(20).default([]),
	skills: z.array(z.string().max(40)).max(50).default([]),
	redirectTo,
}).superRefine((value, ctx) => {
	// Old enough to hold an account (PRODUCT_SPEC §Age guardrails), counted in the person's zone.
	// 13–17 passes: the database derives the restriction from the stored date (`org.fn_is_minor`),
	// so no client flag is read.
	const bracket = bracketFromDob(value.dob, value.timeZone);
	if (bracket === "unknown") {
		ctx.addIssue({ code: "custom", path: ["dob"], message: "Enter a real date of birth." });
	}
	if (bracket === "blocked") {
		ctx.addIssue({ code: "custom", path: ["dob"], message: UNDER_MINIMUM_REFUSAL });
	}
});
export type IndividualJoin = z.infer<typeof IndividualJoinSchema>;

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
	employeeTier: z.enum(EMPLOYEE_TIER_VALUES),
	industry: z.enum(INDUSTRY_VALUES),
	/** Free-text sector; only populated (and required by the client) when `industry === "other"`. */
	industryOther: z.string().trim().max(80).default(""),
	departments: strList,
	locale,
	displayCurrency,
	purpose: z.array(z.string().max(40)).max(20).default([]),
	password,
	redirectTo,
});
export type OrganizationJoin = z.infer<typeof OrganizationJoinSchema>;

/** Discriminated on `type` so one endpoint validates either onboarding shape. */
export const JoinSchema = z.discriminatedUnion("type", [
	IndividualJoinSchema,
	OrganizationJoinSchema,
]);
export type Join = z.infer<typeof JoinSchema>;
// #endregion
