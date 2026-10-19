import type { EmployeeTier, Industry } from "@projective/types/auth";

/**
 * Static option sets and reserved words for the auth forms. The enterprise tiers and industries
 * label the values `@projective/types/auth` owns, which the join schema validates against.
 */

/** A `<select>` / choice option. */
export interface Choice {
	readonly value: string;
	readonly label: string;
}

/** Estimated headcount tiers for the Enterprise onboarding "Scale" step. */
export const EMPLOYEE_TIERS: readonly (Choice & { readonly value: EmployeeTier })[] = [
	{ value: "1-50", label: "1–50 employees" },
	{ value: "51-200", label: "51–200 employees" },
	{ value: "201-500", label: "201–500 employees" },
	{ value: "500+", label: "500+ employees" },
];

/** Primary industry / sector options (extend as needed; "other" is the catch-all). */
export const INDUSTRIES: readonly (Choice & { readonly value: Industry })[] = [
	{ value: "software", label: "Software & IT" },
	{ value: "design", label: "Design & Creative" },
	{ value: "marketing", label: "Marketing & Advertising" },
	{ value: "finance", label: "Finance & Fintech" },
	{ value: "ecommerce", label: "E-commerce & Retail" },
	{ value: "media", label: "Media & Entertainment" },
	{ value: "education", label: "Education" },
	{ value: "healthcare", label: "Healthcare & Biotech" },
	{ value: "manufacturing", label: "Manufacturing & Industrial" },
	{ value: "nonprofit", label: "Non-profit & Government" },
	{ value: "other", label: "Other" },
];

/** A short, illustrative country list for the registered-address step. */
export const COUNTRIES: readonly Choice[] = [
	{ value: "US", label: "United States" },
	{ value: "GB", label: "United Kingdom" },
	{ value: "CA", label: "Canada" },
	{ value: "AU", label: "Australia" },
	{ value: "DE", label: "Germany" },
	{ value: "FR", label: "France" },
	{ value: "NL", label: "Netherlands" },
	{ value: "IE", label: "Ireland" },
	{ value: "IN", label: "India" },
	{ value: "SG", label: "Singapore" },
	{ value: "AE", label: "United Arab Emirates" },
	{ value: "ZA", label: "South Africa" },
	{ value: "other", label: "Other" },
];

/** Base permission tiers offered when inviting initial stakeholders (maps to enterprise RBAC roles). */
export const PERMISSION_TIERS: readonly Choice[] = [
	{ value: "admin", label: "Admin — full control" },
	{ value: "manager", label: "Manager — projects & members" },
	{ value: "member", label: "Member — contribute" },
	{ value: "observer", label: "Observer — read-only" },
];

/**
 * Reserved handles/usernames a person cannot claim — they collide with static top-level routes
 * (ROUTING.md reserved-handle precedence) or are otherwise protected.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
	"join",
	"login",
	"logout",
	"verify",
	"reset",
	"forgot-password",
	"onboarding",
	"api",
	"admin",
	"root",
	"support",
	"help",
	"about",
	"changelog",
	"feedback",
	"features",
	"explore",
	"view",
	"inspect",
	"home",
	"projects",
	"messages",
	"wallet",
	"teams",
	"business",
	"settings",
	"services",
	"become-partner",
	"projective",
	"www",
	"mail",
	"static",
	"assets",
]);
