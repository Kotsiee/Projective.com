/**
 * dev-context.ts — the DEVELOPMENT-ONLY runtime context override store.
 *
 * The signal-first equivalent of a "DevContext provider" (root CLAUDE.md §3 forbids React-context
 * providers in favour of `@preact/signals`). It lets a developer simulate, at runtime, a different
 * persona/account type, entity ownership, and team/business role — without re-authenticating — so
 * chrome and capability gates can be exercised from every angle.
 *
 * It is intentionally **non-invasive**: rather than rewiring every surface, it exposes (a)
 * {@link applyDevContext} to derive an overridden {@link UserContext} from the real one, (b)
 * {@link devOwnerOverride} for ownership gates, and (c) a `data-dev-*` attribute + a `pj:devcontext`
 * `CustomEvent` seam any surface can observe. The whole module is imported only by
 * `apps/web/features/devtools/*`, which Vite excludes from production, so none of this ships.
 *
 * Nothing here grants real access — like User Context Hydration it only changes what the developer's
 * own browser draws; RLS + the route guards remain the real gates.
 */

import { signal } from "@preact/signals";
import type { ContextRole, ContextType, UserContext } from "@projective/types/auth";
import { logger } from "@web/utils/logger.ts";
import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";
import {
	DEV_SEAM_EVENT,
	type DevAssetVisibility,
	type DevBasketOwner,
	type DevBillingContext,
	type DevBuyerDetails,
	type DevConferencing,
	type DevConnectionState,
	type DevDedupState,
	type DevDisplayCurrency,
	type DevEventReschedule,
	type DevEventRsvp,
	type DevEventSeat,
	type DevFulfilmentMix,
	type DevInvoicingMode,
	type DevLayoutDirection,
	type DevLinkScan,
	type DevMemberRole,
	type DevMembershipState,
	type DevMessagingRole,
	type DevMicPermission,
	type DevPaymentProviders,
	type DevPersona,
	type DevProjectType,
	type DevRosterState,
	type DevSavedCards,
	type DevSeamRole,
	type DevServiceType,
	type DevSessionBookingStatus,
	type DevSpendLimit,
	type DevStageAssignment,
	type DevStorageProvider,
	type DevStorageQuota,
	type DevSubmissionState,
	type DevWalletCoverage,
	type DevWalletFundMix,
	type DevWalletKyc,
	type DevWalletSmoother,
	type DevWalletStanding,
	type DevWalletVaultRole,
	type DevWorkspaceKind,
	type DevWorkspaceRole,
	type DevWorkspaceVerification,
	personaCapabilities,
} from "@web/utils/dev-seam.ts";

// #region Shapes
/**
 * The persona / account type a developer can impersonate. Aliased to the shipping-safe
 * {@link DevPersona} in `@web/utils/dev-seam.ts` so the WRITE side (here) and the READ side (any
 * consuming surface, e.g. the `/projects` lane) share one vocabulary.
 */
export type DevAccountType = DevPersona;
/** The team/business role view a developer can impersonate. */
export type DevRole = DevSeamRole;
/** The engagement delivery format a developer can impersonate (submissions ticket handling). */
export type {
	DevBasketOwner,
	DevBillingContext,
	DevBuyerDetails,
	DevConferencing,
	DevDisplayCurrency,
	DevEventReschedule,
	DevEventRsvp,
	DevEventSeat,
	DevFulfilmentMix,
	DevInvoicingMode,
	DevLayoutDirection,
	DevMemberRole,
	DevMessagingRole,
	DevMicPermission,
	DevPaymentProviders,
	DevProjectType,
	DevSavedCards,
	DevServiceType,
	DevSessionBookingStatus,
	DevSpendLimit,
	DevStageAssignment,
	DevSubmissionState,
	DevWalletCoverage,
	DevWalletFundMix,
	DevWalletKyc,
	DevWalletSmoother,
	DevWalletStanding,
	DevWalletVaultRole,
};

/** The full override set. `enabled` is the master switch — when off, {@link applyDevContext} is a pass-through. */
export interface DevOverrides {
	/** Master switch — when `false`, no override is applied anywhere. */
	enabled: boolean;
	/** Simulated persona / account type (`userPersona`). */
	accountType: DevAccountType;
	/**
	 * Simulated **active entity** — the specific workspace the developer is acting within (a scope id or
	 * `@handle`, e.g. a team or business). `""` = auto-derive from the persona. Consumed by surfaces that
	 * scope to a tenant (e.g. the `/projects` feed pins a Business persona to its owned workspace).
	 */
	activeEntity: string;
	/** Simulated entity ownership (`isOwner`) for the current project/service/product/article/profile. */
	isOwner: boolean;
	/** Simulated team/business role. */
	role: DevRole;
	/**
	 * Simulated engagement delivery format. Consumed by the Submissions workflow — a pipeline/session
	 * engagement fulfils tickets (a ticket dropdown in the create-submission modal), a one-off has none.
	 */
	projectType: DevProjectType;
	/**
	 * Simulated service delivery model (task §4). A NEW axis, orthogonal to {@link projectType}, that
	 * discriminates a standard stage-based project/service from a 1-1 session and a group session.
	 * Consumed by the channel-header tab matrix (Calendar session-only; Tasks/Submissions hidden for
	 * sessions) and by the Project Details sidebar (the session sidebar layouts).
	 */
	serviceType: DevServiceType;
	/** Simulated booking state of the session's next slot (upcoming-session widget proposal badge). */
	sessionBookingStatus: DevSessionBookingStatus;
	/** Whether the simulated viewer belongs to several sub-groups in a group session (task §4). */
	multiSubGroup: boolean;
	/**
	 * Whether the simulated freelancer is assigned to the active stage. Consumed by the channel-header
	 * tab gating — an unassigned freelancer loses the Submissions / Tasks / Calendar tabs on a stage.
	 */
	stageAssignment: DevStageAssignment;
	/**
	 * The lifecycle state of the simulated freelancer's active submission. Drives the middle-nav footer /
	 * crumb-bar action state machine (draft → upload/delete/submit; submitted/approved/revision → badge).
	 */
	submissionState: DevSubmissionState;
	/** Whether the client has defined stage/ticket tasks — drives the Tasks panel toggle's visibility. */
	hasTasks: boolean;
	/**
	 * Simulated acting-member view for the Members tab (task §4) — the four access conditions the roster
	 * rules branch on (Owner/Admin · Manager · Freelancer assigned · Freelancer unassigned). Consumed by
	 * the roster island to re-simulate the viewer's capabilities + visible member set.
	 */
	memberRole: DevMemberRole;
	/** Whether the Members tab should surface a pending-invitation queue (task §4). */
	hasPendingInvites: boolean;
	/**
	 * Simulated `/messages` inbox view (task §4) — a NEW axis selecting which advanced-filter set the
	 * inbox sidebar shows (provider-side vs buyer-side) and whether auto-responses are offered. Consumed
	 * by the messaging sidebar + settings modal to re-simulate the role-specific chrome.
	 */
	messagingRole: DevMessagingRole;
	/**
	 * Simulated microphone permission for the chat composer's voice memo — a NEW axis reaching the
	 * capture states that otherwise require changing real browser settings and reloading: a persisted
	 * block, a browser without `MediaRecorder`, and the slow-grant connecting window. `granted` still
	 * asks the real device; nothing here fabricates audio.
	 */
	micPermission: DevMicPermission;
	/**
	 * Simulated `/wallet` vault capability role (Owner/Admin/PM/member) — a NEW axis the Wallet surface's
	 * capability gating rolls up from (which money controls the viewer may operate). Personal wallets are
	 * always owner; this bites only on a team/business vault.
	 */
	walletVaultRole: DevWalletVaultRole;
	/** Simulated `/wallet` finance-verification (KYC) state — drives the KYC-locked earn/withdraw states. */
	walletKyc: DevWalletKyc;
	/** Simulated `/wallet` Income-Smoother state (ineligible / eligible / enrolled). */
	walletSmoother: DevWalletSmoother;
	/** Simulated `/wallet` fund-state mix — which of the three-state balance projection's states carry a balance. */
	walletFundMix: DevWalletFundMix;
	/**
	 * Simulated earned Standing rung — drives the `/wallet` Standing gauge and the marketplace-commission
	 * taper it pays out (8% -> 6.5%). `stage_floor` reaches the state where the score gate is cleared but
	 * the completed-stage volume floor is not, so the rung has NOT advanced.
	 */
	walletStanding: DevWalletStanding;
	/**
	 * Simulated entity kind for the `/teams` · `/businesses` console. A Team is a Freelancer with
	 * several members; a Business is a Client with several members — so this one axis re-parameterises
	 * the whole surface, including which capability columns and modules exist at all.
	 */
	workspaceKind: DevWorkspaceKind;
	/**
	 * Simulated role inside the acting entity. `non_member` is deliberately reachable: it is the only
	 * way to exercise the "does not belong here" path, which must redirect rather than dead-end.
	 */
	workspaceRole: DevWorkspaceRole;
	/** Simulated membership state — `invited` and `requested` route to opposite actions. */
	membershipState: DevMembershipState;
	/** Simulated entity verification — drives the locked-but-actionable KYC/KYB gate. */
	workspaceVerification: DevWorkspaceVerification;
	/** Whether the session is simulated as ACTING as the entity rather than personally. */
	actingContext: boolean;
	/** Simulated roster shape — reaches the selling empty state and the one-person-team pre-state. */
	rosterState: DevRosterState;
	/** Simulated display currency — drives the fat service's conversion + `Intl` formatting (RtL-independent). */
	displayCurrency: DevDisplayCurrency;
	/** Simulated document layout direction (LtR/RtL) — verifies the whole surface mirrors under `dir="rtl"`. */
	layoutDirection: DevLayoutDirection;
	/** Simulated connected cloud-storage provider — reaches the picker's Connected-drives tab states. */
	storageProvider: DevStorageProvider;
	/** Simulated connection lifecycle — `degraded`/`expired` must prompt re-consent, not show an empty folder. */
	connectionState: DevConnectionState;
	/** Simulated storage-quota position — the only way to reach `exceeded` without uploading 25 GB. */
	storageQuota: DevStorageQuota;
	/** Simulated privacy scope of the asset in view — drives the share control and the scope pip. */
	assetVisibility: DevAssetVisibility;
	/** Simulated link-safety verdict — reaches `blocked` without sourcing a genuinely malicious URL. */
	linkScan: DevLinkScan;
	/** Simulated dedup verdict for the next upload — drives the duplicate-resolution panel. */
	dedupState: DevDedupState;
	/**
	 * Simulated basket scope — which principal's money `/basket` and `/checkout` spend. Its own axis
	 * because {@link workspaceKind} is `team | business` and {@link actingContext} is a boolean, so
	 * neither reaches an **organisation** basket — the one scope with no vault in the cast, and so the
	 * one whose payment offer differs most.
	 */
	basketOwner: DevBasketOwner;
	/**
	 * Simulated payment-offer preset. It moves the INPUTS the SSOT's eligibility rules are evaluated
	 * against, never their verdict, so every preset still exercises the real rules.
	 */
	paymentProviders: DevPaymentProviders;
	/** Simulated wallet position against the checkout total (covers it, or falls short). */
	walletCoverage: DevWalletCoverage;
	/** Simulated saved-card wallet shape — seeded, none on file, or all expired. */
	savedCards: DevSavedCards;
	/**
	 * Whether the buyer already has complete saved delivery + billing details.
	 *
	 * The axis that makes the Details step's **auto-skip** reachable. Without it a developer only ever
	 * sees one of the two branches — and the unreachable one is the branch that silently sends a buyer
	 * past a form, which is precisely the branch worth being able to inspect.
	 */
	buyerDetails: DevBuyerDetails;
	/** Simulated billing identity the Details form opens on — a natural person or a company. */
	billingContext: DevBillingContext;
	/**
	 * Simulated invoicing mode (`org.business_profiles.invoicing_mode`) — a real column with a real
	 * CHECK, not a new concept: `intervaled_monthly` is the brief's "Intervaled Monthly Invoicing".
	 */
	invoicingMode: DevInvoicingMode;
	/**
	 * Whether this purchase clears the acting member's spending limit. `over` reaches the
	 * `needs_approval` verdict without having to construct a basket that happens to cross a seeded cap
	 * — the state whose whole point is that it offers a route forward rather than a refusal.
	 */
	spendLimit: DevSpendLimit;
	/**
	 * Which fulfilment routes the confirmation hub has to render. The four look nothing alike — a
	 * download button, a project deep link, a calendar export, and an honest "not ready yet" — so a mix
	 * that only ever contains one of them leaves three untested.
	 */
	fulfilmentMix: DevFulfilmentMix;
	/** Simulated conferencing provider a booked session's join link resolves to. */
	conferencing: DevConferencing;
	/**
	 * Where the acting viewer sits on the calendar event they open. `non_party` is the only runtime
	 * route to the withheld projection — the alternative is signing out, and a signed-out developer
	 * cannot open the authenticated calendars at all.
	 */
	eventSeat: DevEventSeat;
	/** The acting seat's own answer to that event, including "no answer yet". */
	eventRsvp: DevEventRsvp;
	/** The reschedule negotiation state the event opens in (the mode follows the service type). */
	eventReschedule: DevEventReschedule;
}

/** Selectable option metadata for the switcher UI. */
export interface DevOption<T> {
	value: T;
	label: string;
}
// #endregion

// #region Constants
/** The inert default: simulation off, a neutral client with a plain "worker" (member) view. */
export const DEV_DEFAULTS: DevOverrides = {
	enabled: false,
	accountType: "client",
	activeEntity: "",
	isOwner: false,
	role: "worker",
	projectType: "pipeline",
	serviceType: "standard_project",
	sessionBookingStatus: "confirmed",
	multiSubGroup: false,
	stageAssignment: "assigned",
	submissionState: "draft",
	hasTasks: true,
	memberRole: "owner_admin",
	hasPendingInvites: true,
	messagingRole: "freelancer",
	micPermission: "auto",
	walletVaultRole: "admin",
	walletKyc: "verified",
	walletSmoother: "enrolled",
	walletFundMix: "normal",
	walletStanding: "auto",
	workspaceKind: "team",
	workspaceRole: "admin",
	membershipState: "active",
	workspaceVerification: "verified",
	actingContext: false,
	rosterState: "populated",
	displayCurrency: "GBP",
	layoutDirection: "ltr",
	storageProvider: "none",
	connectionState: "disconnected",
	storageQuota: "healthy",
	assetVisibility: "private",
	linkScan: "safe",
	dedupState: "none",
	basketOwner: "personal",
	paymentProviders: "all",
	walletCoverage: "covers",
	savedCards: "seeded",
	buyerDetails: "missing",
	billingContext: "personal",
	invoicingMode: "per_transaction",
	spendLimit: "within",
	fulfilmentMix: "mixed",
	conferencing: "zoom",
	eventSeat: "auto",
	eventRsvp: "auto",
	eventReschedule: "auto",
};

/** Account-type options in display order. */
export const ACCOUNT_TYPES: ReadonlyArray<DevOption<DevAccountType>> = [
	{ value: "client", label: "Client" },
	{ value: "freelancer", label: "Freelancer" },
	{ value: "team", label: "Team" },
	{ value: "business", label: "Business" },
];

/** Role options in display order. */
export const DEV_ROLES: ReadonlyArray<DevOption<DevRole>> = [
	{ value: "admin", label: "Admin" },
	{ value: "manager", label: "Manager" },
	{ value: "worker", label: "Worker" },
	{ value: "guest", label: "Guest" },
];

/** Project-type options in display order (the Submissions workflow ticket handling). */
export const DEV_PROJECT_TYPES: ReadonlyArray<DevOption<DevProjectType>> = [
	{ value: "pipeline", label: "Pipeline" },
	{ value: "one_off", label: "One-off" },
	{ value: "session", label: "Session" },
];

/** Service delivery model options in display order (task §4). */
export const DEV_SERVICE_TYPES: ReadonlyArray<DevOption<DevServiceType>> = [
	{ value: "standard_project", label: "Standard" },
	{ value: "normal_session", label: "1-1 Session" },
	{ value: "group_session", label: "Group Session" },
];

/** Session booking-status options in display order (upcoming-session proposal badge). */
export const DEV_SESSION_BOOKINGS: ReadonlyArray<DevOption<DevSessionBookingStatus>> = [
	{ value: "confirmed", label: "Confirmed" },
	{ value: "client_proposed", label: "Client proposed" },
	{ value: "freelancer_proposed", label: "You proposed" },
];

/** Freelancer stage-assignment options in display order. */
export const DEV_STAGE_ASSIGNMENTS: ReadonlyArray<DevOption<DevStageAssignment>> = [
	{ value: "assigned", label: "Assigned" },
	{ value: "unassigned", label: "Unassigned" },
];

/** Submission-state options in display order (the freelancer action state machine). */
export const DEV_SUBMISSION_STATES: ReadonlyArray<DevOption<DevSubmissionState>> = [
	{ value: "draft", label: "Draft" },
	{ value: "submitted", label: "Submitted" },
	{ value: "approved", label: "Approved" },
	{ value: "revision_requested", label: "Revision" },
];

/** Members-tab acting-role options in display order (task §4). */
export const DEV_MEMBER_ROLES: ReadonlyArray<DevOption<DevMemberRole>> = [
	{ value: "owner_admin", label: "Owner / Admin" },
	{ value: "manager", label: "Manager" },
	{ value: "freelancer_assigned", label: "Freelancer (Assigned)" },
	{ value: "freelancer_unassigned", label: "Freelancer (Unassigned)" },
];

/** Messaging inbox-view options in display order (task §4) — selects the advanced-filter set. */
export const DEV_MESSAGING_ROLES: ReadonlyArray<DevOption<DevMessagingRole>> = [
	{ value: "freelancer", label: "Freelancer" },
	{ value: "client", label: "Client" },
	{ value: "business", label: "Business" },
];

/** Microphone-permission options in display order (chat composer voice capture). */
export const DEV_MIC_PERMISSIONS: ReadonlyArray<DevOption<DevMicPermission>> = [
	{ value: "auto", label: "Auto" },
	{ value: "prompt", label: "Prompt" },
	{ value: "granted", label: "Granted" },
	{ value: "denied", label: "Blocked" },
	{ value: "unsupported", label: "No support" },
];

/** Wallet vault-role options in display order (`/wallet` capability gating). */
export const DEV_WALLET_VAULT_ROLES: ReadonlyArray<DevOption<DevWalletVaultRole>> = [
	{ value: "owner", label: "Owner" },
	{ value: "admin", label: "Admin" },
	{ value: "pm", label: "PM" },
	{ value: "member", label: "Member" },
];

/** Wallet KYC-state options in display order (`/wallet` verification-locked states). */
export const DEV_WALLET_KYCS: ReadonlyArray<DevOption<DevWalletKyc>> = [
	{ value: "verified", label: "Verified" },
	{ value: "unverified", label: "Unverified" },
	{ value: "payout_setup", label: "No payout set" },
];

/** Income-Smoother state options in display order (`/wallet`). */
export const DEV_WALLET_SMOOTHERS: ReadonlyArray<DevOption<DevWalletSmoother>> = [
	{ value: "ineligible", label: "Ineligible" },
	{ value: "eligible", label: "Eligible" },
	{ value: "enrolled", label: "Enrolled" },
];

/** Fund-state mix options in display order (`/wallet` three-state balance). */
export const DEV_WALLET_FUND_MIXES: ReadonlyArray<DevOption<DevWalletFundMix>> = [
	{ value: "normal", label: "Normal" },
	{ value: "locked", label: "Locked" },
	{ value: "pending", label: "Pending" },
	{ value: "dispute", label: "Dispute" },
];

/**
 * Standing-rung options in display order (`/wallet` Standing gauge + commission taper). `Auto` derives
 * the rung from the subject; `Stage floor` is the score-cleared-but-volume-short edge case.
 */
export const DEV_WALLET_STANDINGS: ReadonlyArray<DevOption<DevWalletStanding>> = [
	{ value: "auto", label: "Auto" },
	{ value: "l1", label: "L1 New" },
	{ value: "l2", label: "L2 Estab." },
	{ value: "l3", label: "L3 Trusted" },
	{ value: "l4", label: "L4 Expert" },
	{ value: "l5", label: "L5 Elite" },
	{ value: "stage_floor", label: "Stage floor" },
];

/** Display-currency options in display order. */
/** Entity-kind options for the workspace console. */
export const DEV_WORKSPACE_KINDS: ReadonlyArray<DevOption<DevWorkspaceKind>> = [
	{ value: "team", label: "Team" },
	{ value: "business", label: "Business" },
];

/** Role-inside-the-entity options, most privileged first. */
export const DEV_WORKSPACE_ROLES: ReadonlyArray<DevOption<DevWorkspaceRole>> = [
	{ value: "owner", label: "Owner" },
	{ value: "admin", label: "Admin" },
	{ value: "lead", label: "Lead" },
	{ value: "member", label: "Member" },
	{ value: "non_member", label: "Not a member" },
];

/** Membership-state options. */
export const DEV_MEMBERSHIP_STATES: ReadonlyArray<DevOption<DevMembershipState>> = [
	{ value: "active", label: "Active" },
	{ value: "invited", label: "Invited" },
	{ value: "requested", label: "Requested" },
];

/** Entity verification options (KYC for a team, KYB for a business). */
export const DEV_WORKSPACE_VERIFICATIONS: ReadonlyArray<DevOption<DevWorkspaceVerification>> = [
	{ value: "verified", label: "Verified" },
	{ value: "kyb_pending", label: "Pending" },
	{ value: "unverified", label: "Unverified" },
];

/** Roster-shape options. */
export const DEV_ROSTER_STATES: ReadonlyArray<DevOption<DevRosterState>> = [
	{ value: "populated", label: "Populated" },
	{ value: "single", label: "One-person" },
	{ value: "empty", label: "Empty" },
];

export const DEV_DISPLAY_CURRENCIES: ReadonlyArray<DevOption<DevDisplayCurrency>> = [
	{ value: "GBP", label: "GBP £" },
	{ value: "USD", label: "USD $" },
	{ value: "EUR", label: "EUR €" },
];

/** Layout-direction options in display order (LtR/RtL). */
export const DEV_LAYOUT_DIRECTIONS: ReadonlyArray<DevOption<DevLayoutDirection>> = [
	{ value: "ltr", label: "LtR" },
	{ value: "rtl", label: "RtL" },
	{ value: "auto", label: "Auto" },
];

/** Connected cloud-storage provider options for the `/files` hub + the Asset Picker. */
export const DEV_STORAGE_PROVIDERS: ReadonlyArray<DevOption<DevStorageProvider>> = [
	{ value: "none", label: "None" },
	{ value: "google_drive", label: "Google Drive" },
	{ value: "dropbox", label: "Dropbox" },
	{ value: "frameio", label: "Frame.io" },
	{ value: "s3", label: "S3" },
];

/** Connection lifecycle options. */
export const DEV_CONNECTION_STATES: ReadonlyArray<DevOption<DevConnectionState>> = [
	{ value: "disconnected", label: "Disconnected" },
	{ value: "pending", label: "Pending" },
	{ value: "active", label: "Active" },
	{ value: "degraded", label: "Degraded" },
	{ value: "expired", label: "Expired" },
];

/** Storage-quota position options. */
export const DEV_STORAGE_QUOTAS: ReadonlyArray<DevOption<DevStorageQuota>> = [
	{ value: "empty", label: "Empty" },
	{ value: "healthy", label: "Healthy" },
	{ value: "near_limit", label: "Near limit" },
	{ value: "exceeded", label: "Exceeded" },
	{ value: "unlimited", label: "Unlimited" },
];

/** Asset privacy-scope options. */
export const DEV_ASSET_VISIBILITIES: ReadonlyArray<DevOption<DevAssetVisibility>> = [
	{ value: "private", label: "Private" },
	{ value: "link", label: "Link only" },
	{ value: "public", label: "Public" },
];

/** Link-safety verdict options. */
export const DEV_LINK_SCANS: ReadonlyArray<DevOption<DevLinkScan>> = [
	{ value: "pending", label: "Pending" },
	{ value: "safe", label: "Safe" },
	{ value: "suspicious", label: "Suspicious" },
	{ value: "blocked", label: "Blocked" },
];

/** Dedup-verdict options for the next simulated upload. */
export const DEV_DEDUP_STATES: ReadonlyArray<DevOption<DevDedupState>> = [
	{ value: "none", label: "New file" },
	{ value: "exact_duplicate", label: "Exact duplicate" },
	{ value: "name_collision", label: "Name collision" },
];

/** Basket-scope options for `/basket` + `/checkout` (whose money is being spent). */
export const DEV_BASKET_OWNERS: ReadonlyArray<DevOption<DevBasketOwner>> = [
	{ value: "personal", label: "Personal" },
	{ value: "team", label: "Team" },
	{ value: "business", label: "Business" },
	{ value: "organisation", label: "Organisation" },
];

/** Payment-offer presets for `/checkout`. */
export const DEV_PAYMENT_PROVIDERS: ReadonlyArray<DevOption<DevPaymentProviders>> = [
	{ value: "all", label: "All" },
	{ value: "no_wallet", label: "No wallet" },
	{ value: "card_only", label: "Card only" },
	{ value: "invoice", label: "Invoiceable" },
];

/** Wallet-coverage options for `/checkout` (relative to the resolved total). */
export const DEV_WALLET_COVERAGES: ReadonlyArray<DevOption<DevWalletCoverage>> = [
	{ value: "covers", label: "Covers" },
	{ value: "shortfall", label: "Shortfall" },
];

/** Saved-card wallet options for `/checkout`. */
export const DEV_SAVED_CARDS: ReadonlyArray<DevOption<DevSavedCards>> = [
	{ value: "seeded", label: "Has cards" },
	{ value: "none", label: "None" },
	{ value: "expired", label: "All expired" },
];

/** Saved-details options — the Details step's auto-skip branch selector. */
export const DEV_BUYER_DETAILS: ReadonlyArray<DevOption<DevBuyerDetails>> = [
	{ value: "missing", label: "Missing" },
	{ value: "saved", label: "Saved" },
];

/** Billing-identity options — which form the Details step opens on. */
export const DEV_BILLING_CONTEXTS: ReadonlyArray<DevOption<DevBillingContext>> = [
	{ value: "personal", label: "Personal" },
	{ value: "business", label: "Business" },
];

/** Invoicing-mode options (`org.business_profiles.invoicing_mode`). */
export const DEV_INVOICING_MODES: ReadonlyArray<DevOption<DevInvoicingMode>> = [
	{ value: "per_transaction", label: "Per purchase" },
	{ value: "intervaled_monthly", label: "Monthly" },
];

/** Spending-limit options — `over` is what reaches the `needs_approval` verdict. */
export const DEV_SPEND_LIMITS: ReadonlyArray<DevOption<DevSpendLimit>> = [
	{ value: "within", label: "Within cap" },
	{ value: "over", label: "Over cap" },
];

/** Fulfilment-mix options — which routes the confirmation hub has to render. */
export const DEV_FULFILMENT_MIXES: ReadonlyArray<DevOption<DevFulfilmentMix>> = [
	{ value: "mixed", label: "Mixed" },
	{ value: "products", label: "Products" },
	{ value: "tickets", label: "Tickets" },
	{ value: "sessions", label: "Sessions" },
	{ value: "pending", label: "Pending" },
];

/** Conferencing-provider options for a booked session's join link. */
export const DEV_CONFERENCING: ReadonlyArray<DevOption<DevConferencing>> = [
	{ value: "zoom", label: "Zoom" },
	{ value: "google", label: "Meet" },
	{ value: "microsoft_teams", label: "Teams" },
	{ value: "none", label: "None" },
];

/** Where the viewer sits on the calendar event they open. */
export const DEV_EVENT_SEATS: ReadonlyArray<DevOption<DevEventSeat>> = [
	{ value: "auto", label: "Auto" },
	{ value: "host", label: "Host" },
	{ value: "attendee", label: "Attendee" },
	{ value: "non_party", label: "Stranger" },
];

/** The acting seat's own answer to that event. */
export const DEV_EVENT_RSVPS: ReadonlyArray<DevOption<DevEventRsvp>> = [
	{ value: "auto", label: "Auto" },
	{ value: "accepted", label: "Going" },
	{ value: "tentative", label: "Maybe" },
	{ value: "rejected", label: "No" },
	{ value: "pending", label: "Unanswered" },
];

/** The reschedule negotiation state the event opens in. */
export const DEV_EVENT_RESCHEDULES: ReadonlyArray<DevOption<DevEventReschedule>> = [
	{ value: "auto", label: "Auto" },
	{ value: "none", label: "None" },
	{ value: "collecting", label: "Collecting" },
	{ value: "awaiting_counterparty", label: "Awaiting" },
	{ value: "voting", label: "Voting" },
	{ value: "resolved", label: "Resolved" },
	{ value: "lapsed", label: "Lapsed" },
	{ value: "withdrawn", label: "Withdrawn" },
];
// #endregion

// #region Store
/** The reactive override signal. Read `.value` in a component to subscribe. */
export const devOverrides = signal<DevOverrides>({ ...DEV_DEFAULTS });

/** Rehydrate from sessionStorage (client-only; call from an island effect to avoid an SSR mismatch). */
export function hydrateDevContext(): void {
	const raw = readStored("session", SessionKeys.DEV_CONTEXT_OVERRIDES);
	if (!raw) return;
	try {
		const parsed = JSON.parse(raw) as Partial<DevOverrides>;
		devOverrides.value = { ...DEV_DEFAULTS, ...parsed };
		reflect(devOverrides.value);
	} catch {
		// Corrupt blob — ignore and keep defaults.
	}
}

/** Persist, mirror to the DOM seam, announce, and log a change. */
function commit(next: DevOverrides): void {
	devOverrides.value = next;
	writeStored("session", SessionKeys.DEV_CONTEXT_OVERRIDES, JSON.stringify(next));
	reflect(next);
	logger.info("Dev context override changed", next);
}

/**
 * Mirror the active overrides onto the `<html data-dev-*>` seam and dispatch the {@link DEV_SEAM_EVENT}.
 * This is the WRITE side of the seam that `@web/utils/dev-seam.ts` reads — the attribute names +
 * event are the shared contract that lets shipping surfaces react without importing this dev-only code.
 */
function reflect(next: DevOverrides): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	if (next.enabled) {
		root.dataset.devPersona = next.accountType;
		root.dataset.devRole = next.role;
		root.dataset.devOwner = String(next.isOwner);
		root.dataset.devProjectType = next.projectType;
		root.dataset.devServiceType = next.serviceType;
		root.dataset.devSessionBooking = next.sessionBookingStatus;
		root.dataset.devMultiSubgroup = String(next.multiSubGroup);
		root.dataset.devStageAssignment = next.stageAssignment;
		root.dataset.devSubmissionState = next.submissionState;
		root.dataset.devHasTasks = String(next.hasTasks);
		root.dataset.devMemberRole = next.memberRole;
		root.dataset.devPendingInvites = String(next.hasPendingInvites);
		root.dataset.devMessagingRole = next.messagingRole;
		root.dataset.devMicPermission = next.micPermission;
		root.dataset.devWalletRole = next.walletVaultRole;
		root.dataset.devWalletKyc = next.walletKyc;
		root.dataset.devWalletSmoother = next.walletSmoother;
		root.dataset.devWalletFundMix = next.walletFundMix;
		root.dataset.devWalletStanding = next.walletStanding;
		root.dataset.devWorkspaceKind = next.workspaceKind;
		root.dataset.devWorkspaceRole = next.workspaceRole;
		root.dataset.devMembershipState = next.membershipState;
		root.dataset.devWorkspaceVerification = next.workspaceVerification;
		root.dataset.devActingContext = String(next.actingContext);
		root.dataset.devRosterState = next.rosterState;
		root.dataset.devDisplayCurrency = next.displayCurrency;
		root.dataset.devDirection = next.layoutDirection;
		root.dataset.devStorageProvider = next.storageProvider;
		root.dataset.devConnectionState = next.connectionState;
		root.dataset.devStorageQuota = next.storageQuota;
		root.dataset.devAssetVisibility = next.assetVisibility;
		root.dataset.devLinkScan = next.linkScan;
		root.dataset.devDedupState = next.dedupState;
		root.dataset.devBasketOwner = next.basketOwner;
		root.dataset.devPaymentProviders = next.paymentProviders;
		root.dataset.devWalletCoverage = next.walletCoverage;
		root.dataset.devSavedCards = next.savedCards;
		root.dataset.devBuyerDetails = next.buyerDetails;
		root.dataset.devBillingContext = next.billingContext;
		root.dataset.devInvoicingMode = next.invoicingMode;
		root.dataset.devSpendLimit = next.spendLimit;
		root.dataset.devFulfilmentMix = next.fulfilmentMix;
		root.dataset.devConferencing = next.conferencing;
		root.dataset.devEventSeat = next.eventSeat;
		root.dataset.devEventRsvp = next.eventRsvp;
		root.dataset.devEventReschedule = next.eventReschedule;
		// Flip the document `dir` so the whole app's RtL/LtR mirroring is verifiable at runtime — logical
		// properties everywhere mean the wallet (and the rest of the shell) mirror to the opposite edge.
		root.dir = next.layoutDirection;
		if (next.activeEntity) root.dataset.devEntity = next.activeEntity;
		else delete root.dataset.devEntity;
	} else {
		delete root.dataset.devPersona;
		delete root.dataset.devRole;
		delete root.dataset.devOwner;
		delete root.dataset.devEntity;
		delete root.dataset.devProjectType;
		delete root.dataset.devServiceType;
		delete root.dataset.devSessionBooking;
		delete root.dataset.devMultiSubgroup;
		delete root.dataset.devStageAssignment;
		delete root.dataset.devSubmissionState;
		delete root.dataset.devHasTasks;
		delete root.dataset.devMemberRole;
		delete root.dataset.devPendingInvites;
		delete root.dataset.devMessagingRole;
		delete root.dataset.devMicPermission;
		delete root.dataset.devWalletRole;
		delete root.dataset.devWalletKyc;
		delete root.dataset.devWalletSmoother;
		delete root.dataset.devWalletFundMix;
		delete root.dataset.devWalletStanding;
		delete root.dataset.devWorkspaceKind;
		delete root.dataset.devWorkspaceRole;
		delete root.dataset.devMembershipState;
		delete root.dataset.devWorkspaceVerification;
		delete root.dataset.devActingContext;
		delete root.dataset.devRosterState;
		delete root.dataset.devDisplayCurrency;
		delete root.dataset.devDirection;
		delete root.dataset.devStorageProvider;
		delete root.dataset.devConnectionState;
		delete root.dataset.devStorageQuota;
		delete root.dataset.devAssetVisibility;
		delete root.dataset.devLinkScan;
		delete root.dataset.devDedupState;
		delete root.dataset.devBasketOwner;
		delete root.dataset.devPaymentProviders;
		delete root.dataset.devWalletCoverage;
		delete root.dataset.devSavedCards;
		delete root.dataset.devBuyerDetails;
		delete root.dataset.devBillingContext;
		delete root.dataset.devInvoicingMode;
		delete root.dataset.devSpendLimit;
		delete root.dataset.devFulfilmentMix;
		delete root.dataset.devConferencing;
		delete root.dataset.devEventSeat;
		delete root.dataset.devEventRsvp;
		delete root.dataset.devEventReschedule;
		// Restore the document's natural direction (the pref-driven default, LtR here).
		root.removeAttribute("dir");
	}
	globalThis.dispatchEvent?.(new CustomEvent(DEV_SEAM_EVENT, { detail: next }));
}

/** Patch a subset of the overrides. */
export function patchDevContext(patch: Partial<DevOverrides>): void {
	commit({ ...devOverrides.value, ...patch });
}

/** Toggle the master simulation switch. */
export function setDevEnabled(enabled: boolean): void {
	patchDevContext({ enabled });
}

/** Set the simulated active entity (a workspace id or `@handle`; `""` = auto-derive from the persona). */
export function setDevActiveEntity(activeEntity: string): void {
	patchDevContext({ activeEntity: activeEntity.trim() });
}

/**
 * A flat snapshot of the exposed context hooks — {@link DevOverrides.accountType} surfaced under the
 * `userPersona` name the integration consumes, plus `activeEntity` and `role`. Reads the signal, so a
 * component that calls this inside its render re-runs on change.
 */
export function devContextSnapshot(): {
	enabled: boolean;
	userPersona: DevAccountType;
	activeEntity: string;
	role: DevRole;
	isOwner: boolean;
} {
	const o = devOverrides.value;
	return {
		enabled: o.enabled,
		userPersona: o.accountType,
		activeEntity: o.activeEntity,
		role: o.role,
		isOwner: o.isOwner,
	};
}

/** Reset to the inert default and clear the persisted blob (no defaults are re-written). */
export function resetDevContext(): void {
	removeStored("session", SessionKeys.DEV_CONTEXT_OVERRIDES);
	devOverrides.value = { ...DEV_DEFAULTS };
	reflect(devOverrides.value);
	logger.info("Dev context override reset");
}
// #endregion

// #region Derivations
/**
 * Derive an overridden {@link UserContext} from the real one. A pass-through when simulation is off.
 * Maps the persona to `contextType` + capability flags and the dev role to the coarse chrome
 * {@link ContextRole} (admin/manager → `admin`, worker → `member`, guest → `guest`).
 */
export function applyDevContext(base: UserContext): UserContext {
	const o = devOverrides.value;
	if (!o.enabled) return base;

	const contextType: ContextType = o.accountType === "team"
		? "team"
		: o.accountType === "business"
		? "business"
		: "personal";
	const role: ContextRole = o.role === "admin" || o.role === "manager"
		? "admin"
		: o.role === "guest"
		? "guest"
		: "member";
	// Single-sourced from `personaCapabilities` so the chrome deriver and the `/projects` seam consumer
	// agree — notably a **business is buyer-only** (`isFreelancer: false`, Decisions #9/#10/#16).
	const { isClient, isFreelancer } = personaCapabilities(o.accountType);

	return { ...base, contextType, role, isClient, isFreelancer };
}

/** The ownership override (`true`/`false`) when simulation is on, else `null` (defer to the real value). */
export function devOwnerOverride(): boolean | null {
	const o = devOverrides.value;
	return o.enabled ? o.isOwner : null;
}
// #endregion
