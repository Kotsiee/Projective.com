/**
 * Shared vocabulary for the auth/onboarding feature. Imported by both the islands (client) and the
 * route/API layer (server) so the join payload shape is described in exactly one place.
 */

import type { OAuthPrefill } from "../core/oauth.ts";

/** The two onboarding shapes: a lean individual account, or a comprehensive organization. */
export type AccountType = "individual" | "organization";

/**
 * Initial account intent chosen at signup. Personas remain **additive** (PRODUCT_SPEC.md §Additive,
 * Unlockable Personas) — this only seeds the starting active context; a Client can unlock a
 * Freelancer profile later via `/become-partner`, and vice-versa.
 */
export type UserIntent = "client" | "freelancer";

/** Base permission tier for an invited stakeholder (mirrors org RBAC roles). */
export type PermissionTier = "admin" | "manager" | "member" | "observer";

/** A single "invite a stakeholder" row in the Organization IAM step. */
export interface StakeholderInvite {
	name: string;
	email: string;
	tier: PermissionTier;
}

/** Registered business address (Organization "Contact" step). */
export interface BusinessAddress {
	street: string;
	city: string;
	postcode: string;
	country: string;
}

/** Individual (quick) onboarding payload. */
export interface IndividualJoinPayload {
	type: "individual";
	intent: UserIntent;
	email: string;
	password: string;
	firstName: string;
	lastName: string;
	username: string;
	dob: string;
	/** Derived server-side too; flags a 13–17 account as capability-restricted until 18. */
	restricted: boolean;
	redirectTo: string;
}

/** Organization (comprehensive) onboarding payload. */
export interface OrganizationJoinPayload {
	type: "organization";
	/** Organizations are buyers on Projective — always the client persona, never a seller. */
	intent: "client";
	legalName: string;
	tradingName: string;
	registrationNumber: string;
	/** Optional corporate web footprint — official website / domain. */
	website: string;
	corporateEmail: string;
	phone: string;
	address: BusinessAddress;
	employeeTier: string;
	industry: string;
	departments: string[];
	invites: StakeholderInvite[];
	adminFirstName: string;
	adminLastName: string;
	password: string;
	redirectTo: string;
}

export type JoinPayload = IndividualJoinPayload | OrganizationJoinPayload;

/** Props the `/join` route hands to the JoinExperience island (parsed server-side from the URL). */
export interface JoinFormProps {
	redirectTo: string;
	accountType: AccountType;
	/** Initial intent, or `""` when unchosen (Step 1.2 requires an explicit pick). */
	intent: UserIntent | "";
	prefill: OAuthPrefill | null;
}

/** Shape returned by the auth API stubs. */
export interface AuthResult {
	ok: boolean;
	/** Field-keyed error messages on a 422. */
	errors?: Record<string, string>;
	/** A general (non-field) message, e.g. bad credentials. */
	message?: string;
	/** Where the client should navigate on success. */
	redirectTo?: string;
	/** Whether the next step is email verification (`/verify`). */
	requiresVerification?: boolean;
}
