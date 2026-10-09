import { z } from "zod";
import { KycStatus } from "../finance/verification.ts";
import { VerificationStatusSchema } from "../finance/payments.ts";
import { ConnectionStatus, ConnectionsViewSchema } from "../integrations/connections.ts";
import { NotificationCenterSchema } from "../comms/preferences.ts";
import { MessagingSettingsSchema } from "../messaging/settings.ts";
import { OwnerAvailabilitySchema } from "../scheduling/owner-availability.ts";
import { ProfileSettingsSchema, ProfileVisibility } from "../profile/profile.ts";
import { AppearancePreferencesSchema, DisplayPreferencesSchema } from "../org/preferences.ts";
import { UserEmailSchema } from "../org/user-emails.ts";
import { AccountLifecycleSchema, HandlePolicySchema } from "../org/account-lifecycle.ts";
import { SetupActionSchema } from "../org/onboarding.ts";
import { ConnectedAccountsSchema } from "../auth/identities.ts";
import { CurrentPlanSchema, SubscriptionState } from "../finance/plans.ts";

/**
 * settings — the Zod SSOT for the two-phase Settings engine: the section vocabulary, the facts the
 * attention dashboard is derived from, and the per-section payload `GET /api/settings/[section]`
 * answers (and every `/settings/[section]` page is server-rendered from — one read, two surfaces).
 *
 * The taxonomy itself (labels, icons, keywords, anchors, gates) is presentation and lives in the app
 * (`apps/web/features/settings/core/settings-registry.ts`); this module owns only the keys, so a
 * backend service and the registry can never disagree about what a section is called.
 */

// #region Sections
/** Every section the console and the contextual modal can show, in their display order. */
export const SettingsSectionKey = z.enum([
	"account",
	"profile",
	"workspaces",
	"language",
	"appearance",
	"notifications",
	"messaging",
	"scheduling",
	"billing",
	"verification",
	"integrations",
]);
export type SettingsSectionKey = z.infer<typeof SettingsSectionKey>;

/** The section an unknown or missing key falls back to. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionKey = "account";

/** Narrow an untrusted string (a URL segment, a query value) to a section key. */
export function isSettingsSectionKey(value: unknown): value is SettingsSectionKey {
	return SettingsSectionKey.safeParse(value).success;
}
// #endregion

// #region Attention facts
/** One connection, reduced to what the attention rule reads. */
export const AttentionConnectionSchema = z.object({
	id: z.string(),
	label: z.string(),
	status: ConnectionStatus,
});
export type AttentionConnection = z.infer<typeof AttentionConnectionSchema>;

/**
 * The FACTS the settings attention dashboard and the lane's status marks are derived from. Never a
 * list of items: the rule that turns facts into items is pure and isomorphic
 * (`features/settings/core/attention-model.ts`), so a dev simulation can substitute facts and still
 * exercise the shipping rule. A `null` fact could not be read and contributes nothing — an outage is
 * never reported as "all clear", and never as a problem either.
 */
export const SettingsAttentionFactsSchema = z.object({
	verification: z.object({
		isFreelancer: z.boolean(),
		kycStatus: KycStatus,
		payoutReady: z.boolean(),
		/** `null` when payments are not connected in this environment. */
		payoutStatus: z.string().nullable(),
		processorConnected: z.boolean(),
		businessesNeedingKyb: z.array(
			z.object({ id: z.string(), name: z.string(), canManage: z.boolean() }),
		),
	}).nullable(),
	connections: z.array(AttentionConnectionSchema).nullable(),
	/** Addresses on the account still waiting for their verification link. */
	unverifiedEmails: z.number().int().min(0).nullable(),
	/** The profile setup score (`org.fn_compute_profile_setup_progress`) and its suggested step. */
	profile: z.object({
		/** The PERSON's handle, for the step's address. */
		handle: z.string(),
		score: z.number().int().min(0).max(100),
		pendingSteps: z.number().int().min(0),
		nextAction: SetupActionSchema.nullable(),
	}).nullable(),
	/** Saved cards that have expired or expire this month or next, and the plan's billing state. */
	billing: z.object({
		expiredCards: z.number().int().min(0),
		expiringCards: z.number().int().min(0),
		subscriptionState: SubscriptionState.nullable(),
	}).nullable(),
	/** Sign-in resilience and anything scheduled to be erased. */
	security: z.object({
		/** How many ways the person can sign in (GoTrue identities). */
		signInMethods: z.number().int().min(0),
		/** Whether a provider this environment offers is not yet connected. */
		canAddSignIn: z.boolean(),
		/** ISO dates of a scheduled erasure, when one is scheduled. */
		accountDeletionAt: z.string().nullable(),
		freelancerRemovalAt: z.string().nullable(),
	}).nullable(),
});
export type SettingsAttentionFacts = z.infer<typeof SettingsAttentionFactsSchema>;

/** Facts nobody could read — the honest empty state. */
export const UNKNOWN_ATTENTION_FACTS: SettingsAttentionFacts = {
	verification: null,
	connections: null,
	unverifiedEmails: null,
	profile: null,
	billing: null,
	security: null,
};
// #endregion

// #region Section payloads
/** Account & identity — the names on the account, its handle and birth date, and every address. */
export const AccountSectionSchema = z.object({
	section: z.literal("account"),
	identity: z.object({
		firstName: z.string(),
		lastName: z.string(),
		username: z.string().nullable(),
		/** ISO date (`YYYY-MM-DD`) or `null` when it could not be read. */
		dob: z.string().nullable(),
	}).nullable(),
	emails: z.array(UserEmailSchema).nullable(),
	/** Where the person stands under the @handle change policy. */
	handlePolicy: HandlePolicySchema.nullable(),
	/** The freelancer persona, and any removal or deletion scheduled. */
	lifecycle: AccountLifecycleSchema.nullable(),
	/** The providers the person signs in with. */
	connected: ConnectedAccountsSchema.nullable(),
});

/** Profile visibility and the public-page switches — saved through the profile editor's own route. */
export const ProfileSectionSchema = z.object({
	section: z.literal("profile"),
	/** The PERSON's handle (never the acting entity's slug). */
	handle: z.string().nullable(),
	visibility: ProfileVisibility.nullable(),
	settings: ProfileSettingsSchema.nullable(),
});

/** Workspaces read their rosters on the client through the existing workspace routes. */
export const WorkspacesSectionSchema = z.object({ section: z.literal("workspaces") });

export const LanguageSectionSchema = z.object({
	section: z.literal("language"),
	preferences: DisplayPreferencesSchema,
});

export const AppearanceSectionSchema = z.object({
	section: z.literal("appearance"),
	appearance: AppearancePreferencesSchema,
	/** `false` when the account copy could not be read — the device copy (cookie) is what shows. */
	live: z.boolean(),
});

export const NotificationsSectionSchema = z.object({
	section: z.literal("notifications"),
	center: NotificationCenterSchema.nullable(),
});

export const MessagingSectionSchema = z.object({
	section: z.literal("messaging"),
	settings: MessagingSettingsSchema,
});

export const SchedulingSectionSchema = z.object({
	section: z.literal("scheduling"),
	handle: z.string().nullable(),
	availability: OwnerAvailabilitySchema.nullable(),
});

/**
 * Billing — the plan held (the subscription placeholder); the saved cards are read on the client
 * through the existing `/api/cards` routes.
 */
export const BillingSectionSchema = z.object({
	section: z.literal("billing"),
	plan: CurrentPlanSchema.nullable(),
});

export const VerificationSectionSchema = z.object({
	section: z.literal("verification"),
	status: VerificationStatusSchema.nullable(),
});

export const IntegrationsSectionSchema = z.object({
	section: z.literal("integrations"),
	view: ConnectionsViewSchema.nullable(),
});

/** One section's payload, discriminated on `section`. */
export const SettingsSectionDataSchema = z.discriminatedUnion("section", [
	AccountSectionSchema,
	ProfileSectionSchema,
	WorkspacesSectionSchema,
	LanguageSectionSchema,
	AppearanceSectionSchema,
	NotificationsSectionSchema,
	MessagingSectionSchema,
	SchedulingSectionSchema,
	BillingSectionSchema,
	VerificationSectionSchema,
	IntegrationsSectionSchema,
]);
export type SettingsSectionData = z.infer<typeof SettingsSectionDataSchema>;

/** The payload of one specific section. */
export type SettingsSectionDataOf<K extends SettingsSectionKey> = Extract<
	SettingsSectionData,
	{ section: K }
>;

/**
 * `GET /api/settings/[section]` — the section's payload plus a reason when part of it could not be
 * read (a section renders what it has and says what it lacks; it never fakes the rest).
 */
export const SettingsSectionEnvelopeSchema = z.object({
	data: SettingsSectionDataSchema,
	error: z.string().nullable(),
});
export type SettingsSectionEnvelope = z.infer<typeof SettingsSectionEnvelopeSchema>;
// #endregion
