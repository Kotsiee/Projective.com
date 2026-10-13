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
import type { ProjectAccess, ProjectStatus } from "@projective/types/projects";
import { encodeLandingSim, LANDING_SIM_COOKIE } from "@features/projects/core/landing-sim.ts";
import { DISCOVERY_SIM_COOKIE, encodeDiscoverySim } from "@features/explore/core/discovery-sim.ts";
import { EMBEDDINGS_OVERRIDE_COOKIE } from "@projective/types/explore";
import { AGE_OVERRIDE_COOKIE } from "@projective/types/auth";
import { PAYOUT_OVERRIDE_COOKIE } from "@projective/types/finance";
import { logger } from "@web/utils/logger.ts";
import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";
import {
	DEV_SEAM_EVENT,
	type DevAccountLifecycle,
	type DevLayoutDirection,
	type DevMemberRole,
	type DevMessagingRole,
	type DevMicPermission,
	type DevPersona,
	type DevProfileSetup,
	type DevProjectOnboarding,
	type DevProjectType,
	type DevProposalAllowance,
	type DevRevisionAllotment,
	type DevAutoFundMode,
	type DevLowBalance,
	type DevNotifications,
	type DevSessionState,
	type DevBasketScenario,
	type DevSaved,
	type DevPromoDismissal,
	type DevDiscoveryViewer,
	type DevDiscoveryActivity,
	type DevEmbeddings,
	type DevEmailConfirmation,
	type DevAgeRestriction,
	type DevPayoutReadiness,
	type DevSeamRole,
	type DevServiceType,
	type DevSessionBookingStatus,
	type DevSettingsAttention,
	type DevStageAssignment,
	type DevSubmissionState,
	type DevFundingState,
	type DevTrustAdornments,
	type DevVerificationStamp,
	type DevWalletAurora,
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
/** A simulated access toward the open engagement, or `auto` for the real one (Decision #144). */
export type DevProjectAccess = "auto" | ProjectAccess;
/** A simulated lifecycle status for the open engagement, or `auto` for the real one. */
export type DevProjectStatus = "auto" | ProjectStatus;
/** The engagement delivery format a developer can impersonate (submissions ticket handling). */
export type {
	DevAccountLifecycle,
	DevLayoutDirection,
	DevMemberRole,
	DevMessagingRole,
	DevMicPermission,
	DevProfileSetup,
	DevProjectType,
	DevProposalAllowance,
	DevRevisionAllotment,
	DevAutoFundMode,
	DevLowBalance,
	DevNotifications,
	DevSessionState,
	DevBasketScenario,
	DevSaved,
	DevServiceType,
	DevSessionBookingStatus,
	DevSettingsAttention,
	DevStageAssignment,
	DevSubmissionState,
	DevFundingState,
	DevTrustAdornments,
	DevVerificationStamp,
	DevWalletAurora,
	DevDiscoveryViewer,
	DevDiscoveryActivity,
	DevEmbeddings,
	DevEmailConfirmation,
	DevAgeRestriction,
	DevPayoutReadiness,
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
	 * Simulated onboarded-provider position for the project setup surface (`/projects/[projectId]`) —
	 * the post-onboarding immutability locks (project onboarded → the Project-type control locks; stage
	 * onboarded → that stage's ticket price locks).
	 *
	 * Its own axis because the counts are SERVER facts (`projects.stage_assignments`) that no form
	 * control writes: the only other way to see a locked setup surface is to genuinely onboard a
	 * freelancer onto a project. `first_stage` is the value worth having — it is the only one that
	 * distinguishes a per-stage lock from a project-wide one.
	 */
	projectOnboarding: DevProjectOnboarding;
	/**
	 * Simulated access toward the open engagement — owner · participant · prospect — for the dispatch
	 * of `/projects/[slug]` (Decision #144): an owner's Overview, a participant's, or a prospect sent to
	 * the public listing. `auto` defers to the server's real answer.
	 *
	 * Unlike every axis above, this one is decided SERVER-side, before a byte of the page renders — so
	 * the `data-dev-*` seam cannot reach it. {@link reflect} also writes it into the `pj.dev.landing`
	 * cookie, which the project middleware honours in development only, and the panel reloads the page.
	 */
	projectAccess: DevProjectAccess;
	/**
	 * Simulated lifecycle status for the same dispatch — a draft sends its owner to `/details`, a
	 * closed engagement's Overview reads as a record. `auto` defers to the real status. Server-side, so
	 * it rides the same cookie as {@link projectAccess}.
	 */
	projectStatus: DevProjectStatus;
	/**
	 * Simulated acting-member view for the Members tab (task §4) — the four access conditions the roster
	 * rules branch on (Owner/Admin · Manager · Freelancer assigned · Freelancer unassigned). Consumed by
	 * the roster island to re-simulate the viewer's capabilities + visible member set.
	 */
	memberRole: DevMemberRole;
	/** Whether the Members tab should surface a pending-invitation queue (task §4). */
	hasPendingInvites: boolean;
	/** Whether the Members tab's Requests section should carry open applications. */
	hasPendingRequests: boolean;
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
	/** Simulated document layout direction (LtR/RtL) — verifies the whole surface mirrors under `dir="rtl"`. */
	layoutDirection: DevLayoutDirection;
	/**
	 * Simulated setup position of the viewer's own profile — the header account popover's completion
	 * ring, next-step call to action and presence pip. Substitutes what the SQL completeness rule would
	 * answer (Decision #155); `auto` defers to the real `GET /api/user/setup`.
	 */
	profileSetup: DevProfileSetup;
	/**
	 * How the `/wallet` hero's live aurora is chosen: `auto` runs the shipping gates and watchdog,
	 * `static` keeps the resting CSS gradient, `animated` forces the shader past the hardware gates and
	 * the watchdog (still honouring reduced motion and a hidden page). Its own axis because core count,
	 * device memory and frame times are device facts no page control can change.
	 */
	walletAurora: DevWalletAurora;
	/**
	 * The `/settings` attention dashboard and lane marks: the real facts, a fully set-up account, or
	 * every rule tripped once. Its own axis because KYC, payout and connector states are server facts
	 * no settings control can change (Decision #150).
	 */
	settingsAttention: DevSettingsAttention;
	/**
	 * Settings → Account's handle policy and lifecycle: the real reads, a handle inside its correction
	 * window or locked, or a freelancer removal or account deletion scheduled. Its own axis because
	 * those are server clocks no control can reach without really changing a handle or scheduling an
	 * erasure (Decision #156).
	 */
	accountLifecycle: DevAccountLifecycle;
	/**
	 * The proposal allowance the popover meter, the lane disclosure and the apply modal render
	 * (Decision #154): the real read, or a substituted status — plenty, low, paced (enforced or soft),
	 * the week spent, or a one-member team. Its own axis because tokens, the drip clock and a roster are
	 * server facts no control can reach without spending real proposals.
	 */
	proposalAllowance: DevProposalAllowance;
	/**
	 * The verification stamp the account popover and the profile hero draw (Decision #155). Raising it
	 * fires the milestone celebration, so the toast and the stamp animation are reachable without a
	 * provider webhook.
	 */
	verificationStamp: DevVerificationStamp;
	/** The earned trust signals the profile hero lists (Decision #155): stored, none, first-tier or top-tier. */
	trustAdornments: DevTrustAdornments;
	/**
	 * The per-ticket funding state the funding status line renders (Decision #165): `auto` shows the
	 * server's `deriveFundingState`; any state renders that state with the card's real amount. Its own
	 * axis because a hold, a refused hold and a pending card payment move money to reach.
	 */
	fundingState: DevFundingState;
	/**
	 * The submission review's revision allotment (Decision #167): `auto` shows the stage's real terms,
	 * `exhausted` uses the free rounds up (Buy a revision), `paid` opens a funded paid round on the
	 * active unit (the freelancer's "you can start"). Its own axis because both move only on a real
	 * review or a real payment.
	 */
	revisionAllotment: DevRevisionAllotment;
	/**
	 * The business auto-fund mode the Billing module shows (PRODUCT_SPEC §Escrow, Wallets & Finance #4);
	 * `from_wallet` also previews a funded ticket's "Auto-funded from wallet" line. Its own axis because the
	 * real mode only acts on a refused hold.
	 */
	autoFundMode: DevAutoFundMode;
	/** The Billing module's low-balance warning: `below` shows it, `above` hides it, `auto` reads the floor. */
	lowBalance: DevLowBalance;
	/**
	 * A session's server-only facts (Decision #171): a full cohort, a sitting in progress, every sitting
	 * over, and a seat escrow waiting out the 24-hour window. Each takes a real booking, a real clock or
	 * the auto-release sweep to reach, so the listing lane and the session sidebar preview them here.
	 */
	sessionState: DevSessionState;
	/**
	 * The header drawer's and `/notifications`' inbox (DESIGN_SYSTEM §D.9): the real one, none at all,
	 * many unread across every category, or a realtime burst of arrivals. Its own axis because an
	 * empty inbox, a full one and a run of new events all need someone else's actions to reach.
	 */
	notifications: DevNotifications;
	/**
	 * The header basket drawer: the real basket, an empty one, a switcher holding personal + team +
	 * business baskets, or a basket with an unavailable line. Its own axis because a second paying
	 * account and a delisted item both take other people's actions to reach.
	 */
	basketScenario: DevBasketScenario;
	/**
	 * The saved set behind `/saved` and every star / save control: the real one, nothing saved, or
	 * saved items of every kind in two collections (Decision #180). Its own axis because filling every
	 * kind by hand takes a project, a conversation, a file and a listing.
	 */
	saved: DevSaved;
	/**
	 * The Explore Home's dismissible promo slots: the device's stored dismissals, every slot shown, or
	 * every slot dismissed. Its own axis because a dismissal lives in one browser's storage, and undoing
	 * it otherwise means clearing site data.
	 */
	promoDismissal: DevPromoDismissal;
	/**
	 * The Explore Home's personal rails as a cold-start viewer would see them: the real history, no
	 * history (so "Picked for you" falls back to stated interests), or no signals at all. Server-side —
	 * mirrored into the `pj.dev.discovery` cookie — because a fresh account is otherwise the only way
	 * to reach it.
	 */
	discoveryViewer: DevDiscoveryViewer;
	/**
	 * The Trending rail on a quiet platform: real activity, or none (the "New on Projective" fallback).
	 * Server-side, through the same cookie; otherwise three accounts must open the same thing to flip it.
	 */
	discoveryActivity: DevDiscoveryActivity;
	/**
	 * Discovery's voyage-4 ranking (Decision #179): follow `EMBEDDINGS_ENABLED`, or force it on or off
	 * for this browser — search re-ranking and the `/view` "Similar" rail. Server-side, through the
	 * `pj.dev.embeddings` cookie; otherwise flipping it means editing the environment and restarting.
	 */
	embeddings: DevEmbeddings;
	/**
	 * The `/verify` confirmation poll (Decision #185): the server's answer, or a substituted pending,
	 * confirmed-without-session ("Email confirmed — sign in") or confirmed-and-signed-in answer. Its
	 * own axis because confirming needs a real inbox and the stub backend never confirms.
	 */
	emailConfirmation: DevEmailConfirmation;
	/**
	 * The age guardrail (Decision #190): follow the token's `isRestricted` claim, act as a 13–17
	 * account (every buy/sell route answers the age 403), or skip the routes' mirror so a real minor
	 * meets the database's own refusal. Server-side, through the `pj.dev.age` cookie.
	 */
	ageRestriction: DevAgeRestriction;
	/**
	 * The earning gate (Decision #196): let the database decide, or act as a person who has not verified
	 * their identity and payout account, so every route that lands a gig or creates a team answers the
	 * payout 403 with its Settings → Verification link. Server-side, through the `pj.dev.payout` cookie.
	 */
	payoutReadiness: DevPayoutReadiness;
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
	projectOnboarding: "auto",
	projectAccess: "auto",
	projectStatus: "auto",
	memberRole: "owner_admin",
	hasPendingInvites: true,
	hasPendingRequests: true,
	messagingRole: "freelancer",
	micPermission: "auto",
	layoutDirection: "ltr",
	profileSetup: "auto",
	walletAurora: "auto",
	settingsAttention: "auto",
	accountLifecycle: "auto",
	proposalAllowance: "auto",
	verificationStamp: "auto",
	trustAdornments: "auto",
	fundingState: "auto",
	revisionAllotment: "auto",
	autoFundMode: "auto",
	lowBalance: "auto",
	sessionState: "auto",
	notifications: "auto",
	basketScenario: "auto",
	saved: "auto",
	promoDismissal: "auto",
	discoveryViewer: "auto",
	discoveryActivity: "auto",
	embeddings: "auto",
	emailConfirmation: "auto",
	ageRestriction: "auto",
	payoutReadiness: "auto",
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

/**
 * Simulated engagement-access options in display order (the `/projects/[slug]` dispatch, Decision
 * #144). `Auto` defers to the server; `Prospect` is the case no seeded fixture reaches.
 */
export const DEV_PROJECT_ACCESSES: ReadonlyArray<DevOption<DevProjectAccess>> = [
	{ value: "auto", label: "Auto" },
	{ value: "owner", label: "Owner" },
	{ value: "participant", label: "Participant" },
	{ value: "prospect", label: "Prospect" },
];

/** Simulated engagement-status options in display order (the same dispatch). */
export const DEV_PROJECT_STATUSES: ReadonlyArray<DevOption<DevProjectStatus>> = [
	{ value: "auto", label: "Auto" },
	{ value: "draft", label: "Draft" },
	{ value: "active", label: "Active" },
	{ value: "on_hold", label: "On hold" },
	{ value: "completed", label: "Completed" },
	{ value: "cancelled", label: "Cancelled" },
];

/**
 * Onboarded-provider options in display order (the project setup surface's immutability locks).
 * `Auto` defers to the server's real count; `First stage` is the per-stage proof case.
 */
export const DEV_PROJECT_ONBOARDINGS: ReadonlyArray<DevOption<DevProjectOnboarding>> = [
	{ value: "auto", label: "Auto" },
	{ value: "none", label: "Nobody" },
	{ value: "first_stage", label: "First stage" },
	{ value: "all_stages", label: "All stages" },
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

/** Layout-direction options in display order (LtR/RtL). */
export const DEV_LAYOUT_DIRECTIONS: ReadonlyArray<DevOption<DevLayoutDirection>> = [
	{ value: "ltr", label: "LtR" },
	{ value: "rtl", label: "RtL" },
	{ value: "auto", label: "Auto" },
];

/**
 * Profile-setup options in display order (the account popover's ring, nudge and pip). `Auto` defers
 * to the real read; `New` is the 40% a finished sign-up reads, `Complete` the one state where the
 * percentage gives way to the verification status.
 */
export const DEV_PROFILE_SETUPS: ReadonlyArray<DevOption<DevProfileSetup>> = [
	{ value: "auto", label: "Auto" },
	{ value: "new", label: "New" },
	{ value: "live", label: "Live" },
	{ value: "complete", label: "Complete" },
];

/**
 * Wallet-aurora options in display order (the `/wallet` hero's live shader). `Animated` is the value
 * worth having: it runs the shader on a machine the hardware gates or the watchdog would refuse.
 */
export const DEV_WALLET_AURORAS: ReadonlyArray<DevOption<DevWalletAurora>> = [
	{ value: "auto", label: "Auto" },
	{ value: "static", label: "Static" },
	{ value: "animated", label: "Animated" },
];

/** Settings-attention options in display order (the `/settings` dashboard and the lane's marks). */
export const DEV_SETTINGS_ATTENTIONS: ReadonlyArray<DevOption<DevSettingsAttention>> = [
	{ value: "auto", label: "Auto" },
	{ value: "clear", label: "All clear" },
	{ value: "all", label: "Everything" },
];

/** Account-lifecycle options in display order (Settings → Account). */
export const DEV_ACCOUNT_LIFECYCLES: ReadonlyArray<DevOption<DevAccountLifecycle>> = [
	{ value: "auto", label: "Auto" },
	{ value: "handle-window", label: "Handle: 1 left" },
	{ value: "handle-locked", label: "Handle locked" },
	{ value: "removal-scheduled", label: "Removal due" },
	{ value: "deletion-scheduled", label: "Deletion due" },
];

/**
 * Proposal-allowance options in display order. `Paced` is the value worth having: an enforced empty
 * buffer — the disabled submit and the live countdown, which no seeded persona sits at.
 */
export const DEV_PROPOSAL_ALLOWANCES: ReadonlyArray<DevOption<DevProposalAllowance>> = [
	{ value: "auto", label: "Auto" },
	{ value: "healthy", label: "Healthy" },
	{ value: "low", label: "Low" },
	{ value: "paced", label: "Paced" },
	{ value: "paced_soft", label: "Paced (unenforced)" },
	{ value: "weekly", label: "Week spent" },
	{ value: "team_small", label: "Team < 2" },
];

/**
 * Verification-stamp options in display order. Stepping `None` → `Payout` is the value worth having:
 * it fires the milestone celebration, which otherwise needs a KYC and a payout webhook.
 */
export const DEV_VERIFICATION_STAMPS: ReadonlyArray<DevOption<DevVerificationStamp>> = [
	{ value: "auto", label: "Auto" },
	{ value: "none", label: "None" },
	{ value: "id_verified", label: "Identity" },
	{ value: "vault_verified", label: "Payout" },
	{ value: "corporate_verified", label: "Corporate" },
];

/** Trust-signal options in display order (the profile hero's inline line). */
export const DEV_TRUST_ADORNMENTS: ReadonlyArray<DevOption<DevTrustAdornments>> = [
	{ value: "auto", label: "Auto" },
	{ value: "none", label: "None" },
	{ value: "earned", label: "Earned" },
	{ value: "top", label: "Top tier" },
];

/** Ticket funding-state options in lifecycle order (PRODUCT_MANAGEMENT §3.6). */
export const DEV_FUNDING_STATES: ReadonlyArray<DevOption<DevFundingState>> = [
	{ value: "auto", label: "Auto" },
	{ value: "draft", label: "Draft" },
	{ value: "needs_funding", label: "Needs funding" },
	{ value: "processing", label: "Processing" },
	{ value: "failed", label: "Failed" },
	{ value: "funded", label: "Funded" },
	{ value: "in_progress", label: "In progress" },
	{ value: "in_review", label: "In review" },
	{ value: "released", label: "Released" },
	{ value: "refunded", label: "Refunded" },
];

/** Revision-allotment options (Decision #167). */
export const DEV_REVISION_ALLOTMENTS: ReadonlyArray<DevOption<DevRevisionAllotment>> = [
	{ value: "auto", label: "Auto" },
	{ value: "exhausted", label: "Exhausted" },
	{ value: "paid", label: "Paid round open" },
];

/** Business auto-fund mode options (PRODUCT_SPEC §Escrow, Wallets & Finance #4). */
export const DEV_AUTO_FUND_MODES: ReadonlyArray<DevOption<DevAutoFundMode>> = [
	{ value: "auto", label: "Auto" },
	{ value: "off", label: "Off" },
	{ value: "add_to_basket", label: "Basket" },
	{ value: "from_wallet", label: "Wallet" },
];

/** Low-balance warning options. */
export const DEV_LOW_BALANCES: ReadonlyArray<DevOption<DevLowBalance>> = [
	{ value: "auto", label: "Auto" },
	{ value: "below", label: "Below floor" },
	{ value: "above", label: "Above floor" },
];

/** Notification inbox options (DESIGN_SYSTEM §D.9). */
export const DEV_NOTIFICATIONS: ReadonlyArray<DevOption<DevNotifications>> = [
	{ value: "auto", label: "Auto" },
	{ value: "empty", label: "None" },
	{ value: "many", label: "Many unread" },
	{ value: "burst", label: "Realtime burst" },
];

/** Basket drawer scenarios. */
export const DEV_BASKET_SCENARIOS: ReadonlyArray<DevOption<DevBasketScenario>> = [
	{ value: "auto", label: "Auto" },
	{ value: "empty", label: "Empty" },
	{ value: "multi_owner", label: "Personal + team + business" },
	{ value: "unavailable", label: "Unavailable item" },
];

/** Saved-set scenarios (Decision #180). */
export const DEV_SAVED: ReadonlyArray<DevOption<DevSaved>> = [
	{ value: "auto", label: "Auto" },
	{ value: "empty", label: "Nothing saved" },
	{ value: "many", label: "Every type" },
];

/** Session state options (Decision #171). */
export const DEV_SESSION_STATES: ReadonlyArray<DevOption<DevSessionState>> = [
	{ value: "auto", label: "Auto" },
	{ value: "seat_full", label: "Seat full" },
	{ value: "live", label: "Live" },
	{ value: "ended", label: "Ended" },
	{ value: "release_pending", label: "Auto-release pending" },
];

/** Explore Home promo dismissal options. */
export const DEV_PROMO_DISMISSALS: ReadonlyArray<DevOption<DevPromoDismissal>> = [
	{ value: "auto", label: "Auto" },
	{ value: "visible", label: "Never dismissed" },
	{ value: "dismissed", label: "Dismissed" },
];

/** Explore Home cold-start viewer options (the personal rails). */
export const DEV_DISCOVERY_VIEWERS: ReadonlyArray<DevOption<DevDiscoveryViewer>> = [
	{ value: "auto", label: "Auto" },
	{ value: "no_history", label: "No history" },
	{ value: "no_signals", label: "No signals" },
];

/** Explore Home Trending activity options. */
export const DEV_DISCOVERY_ACTIVITIES: ReadonlyArray<DevOption<DevDiscoveryActivity>> = [
	{ value: "auto", label: "Auto" },
	{ value: "quiet", label: "Quiet platform" },
];

/** Discovery embeddings options (Decision #179). `Follow env` defers to `EMBEDDINGS_ENABLED`. */
export const DEV_EMBEDDINGS: ReadonlyArray<DevOption<DevEmbeddings>> = [
	{ value: "auto", label: "Follow env" },
	{ value: "on", label: "On" },
	{ value: "off", label: "Off" },
];

/** `/verify` poll answers (Decision #185). `Server` asks the real endpoint. */
export const DEV_EMAIL_CONFIRMATIONS: ReadonlyArray<DevOption<DevEmailConfirmation>> = [
	{ value: "auto", label: "Server" },
	{ value: "pending", label: "Pending" },
	{ value: "confirmed", label: "Confirmed" },
	{ value: "confirmed_signed_in", label: "Signed in" },
];

/** Age guardrail positions (Decision #190). `Token` follows the session's `isRestricted` claim. */
export const DEV_AGE_RESTRICTIONS: ReadonlyArray<DevOption<DevAgeRestriction>> = [
	{ value: "auto", label: "Token" },
	{ value: "minor", label: "Minor (13–17)" },
	{ value: "adult", label: "Adult" },
];

/** Earning-gate positions (Decision #196). `Database` lets `finance.fn_assert_payout_ready` decide. */
export const DEV_PAYOUT_READINESS: ReadonlyArray<DevOption<DevPayoutReadiness>> = [
	{ value: "auto", label: "Database" },
	{ value: "not_ready", label: "Not ready" },
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
		// Written only while it is actually overriding something. `auto` means "defer to whatever the
		// server resolved", which is exactly what an ABSENT attribute already means to `readDevSeam`
		// (its `coerce` fallback is `auto`) — so stamping the word would give "no override" a second
		// spelling that every reader would then have to know about. Same shape as `devEntity` below.
		if (next.projectOnboarding !== "auto") {
			root.dataset.devProjectOnboarding = next.projectOnboarding;
		} else {
			delete root.dataset.devProjectOnboarding;
		}
		// The landing pair follows the same "absent = auto" rule on the seam.
		if (next.projectAccess !== "auto") root.dataset.devProjectAccess = next.projectAccess;
		else delete root.dataset.devProjectAccess;
		if (next.projectStatus !== "auto") root.dataset.devProjectStatus = next.projectStatus;
		else delete root.dataset.devProjectStatus;
		root.dataset.devMemberRole = next.memberRole;
		root.dataset.devPendingInvites = String(next.hasPendingInvites);
		root.dataset.devPendingRequests = String(next.hasPendingRequests);
		root.dataset.devMessagingRole = next.messagingRole;
		root.dataset.devMicPermission = next.micPermission;
		// Absent = `auto` on the seam, like `projectOnboarding` above.
		if (next.profileSetup !== "auto") root.dataset.devProfileSetup = next.profileSetup;
		else delete root.dataset.devProfileSetup;
		if (next.walletAurora !== "auto") root.dataset.devWalletAurora = next.walletAurora;
		else delete root.dataset.devWalletAurora;
		if (next.settingsAttention !== "auto") {
			root.dataset.devSettingsAttention = next.settingsAttention;
		} else delete root.dataset.devSettingsAttention;
		if (next.accountLifecycle !== "auto") {
			root.dataset.devAccountLifecycle = next.accountLifecycle;
		} else delete root.dataset.devAccountLifecycle;
		if (next.proposalAllowance !== "auto") {
			root.dataset.devProposalAllowance = next.proposalAllowance;
		} else delete root.dataset.devProposalAllowance;
		if (next.verificationStamp !== "auto") {
			root.dataset.devVerificationStamp = next.verificationStamp;
		} else delete root.dataset.devVerificationStamp;
		if (next.trustAdornments !== "auto") root.dataset.devTrustAdornments = next.trustAdornments;
		else delete root.dataset.devTrustAdornments;
		if (next.fundingState !== "auto") root.dataset.devFundingState = next.fundingState;
		else delete root.dataset.devFundingState;
		if (next.revisionAllotment !== "auto") {
			root.dataset.devRevisionAllotment = next.revisionAllotment;
		} else delete root.dataset.devRevisionAllotment;
		if (next.autoFundMode !== "auto") root.dataset.devAutoFundMode = next.autoFundMode;
		else delete root.dataset.devAutoFundMode;
		if (next.lowBalance !== "auto") root.dataset.devLowBalance = next.lowBalance;
		else delete root.dataset.devLowBalance;
		if (next.sessionState !== "auto") root.dataset.devSessionState = next.sessionState;
		else delete root.dataset.devSessionState;
		if (next.notifications !== "auto") root.dataset.devNotifications = next.notifications;
		else delete root.dataset.devNotifications;
		if (next.basketScenario !== "auto") root.dataset.devBasketScenario = next.basketScenario;
		else delete root.dataset.devBasketScenario;
		if (next.saved !== "auto") root.dataset.devSaved = next.saved;
		else delete root.dataset.devSaved;
		if (next.promoDismissal !== "auto") root.dataset.devPromoDismissal = next.promoDismissal;
		else delete root.dataset.devPromoDismissal;
		if (next.discoveryViewer !== "auto") root.dataset.devDiscoveryViewer = next.discoveryViewer;
		else delete root.dataset.devDiscoveryViewer;
		if (next.discoveryActivity !== "auto") {
			root.dataset.devDiscoveryActivity = next.discoveryActivity;
		} else delete root.dataset.devDiscoveryActivity;
		if (next.embeddings !== "auto") root.dataset.devEmbeddings = next.embeddings;
		else delete root.dataset.devEmbeddings;
		if (next.emailConfirmation !== "auto") {
			root.dataset.devEmailConfirmation = next.emailConfirmation;
		} else delete root.dataset.devEmailConfirmation;
		if (next.ageRestriction !== "auto") root.dataset.devAgeRestriction = next.ageRestriction;
		else delete root.dataset.devAgeRestriction;
		if (next.payoutReadiness !== "auto") root.dataset.devPayoutReadiness = next.payoutReadiness;
		else delete root.dataset.devPayoutReadiness;
		root.dataset.devDirection = next.layoutDirection;
		// Flip the document `dir` so the whole app's RtL/LtR mirroring is verifiable at runtime — logical
		// properties everywhere mean the shell and every surface mirror to the opposite edge.
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
		delete root.dataset.devProjectOnboarding;
		delete root.dataset.devProjectAccess;
		delete root.dataset.devProjectStatus;
		delete root.dataset.devMemberRole;
		delete root.dataset.devPendingInvites;
		delete root.dataset.devPendingRequests;
		delete root.dataset.devMessagingRole;
		delete root.dataset.devMicPermission;
		delete root.dataset.devProfileSetup;
		delete root.dataset.devWalletAurora;
		delete root.dataset.devSettingsAttention;
		delete root.dataset.devAccountLifecycle;
		delete root.dataset.devProposalAllowance;
		delete root.dataset.devVerificationStamp;
		delete root.dataset.devTrustAdornments;
		delete root.dataset.devFundingState;
		delete root.dataset.devRevisionAllotment;
		delete root.dataset.devAutoFundMode;
		delete root.dataset.devLowBalance;
		delete root.dataset.devSessionState;
		delete root.dataset.devNotifications;
		delete root.dataset.devBasketScenario;
		delete root.dataset.devSaved;
		delete root.dataset.devPromoDismissal;
		delete root.dataset.devDiscoveryViewer;
		delete root.dataset.devDiscoveryActivity;
		delete root.dataset.devEmbeddings;
		delete root.dataset.devEmailConfirmation;
		delete root.dataset.devAgeRestriction;
		delete root.dataset.devPayoutReadiness;
		delete root.dataset.devDirection;
		// Restore the document's natural direction (the pref-driven default, LtR here).
		root.removeAttribute("dir");
	}
	writeLandingCookie(next);
	writeDiscoveryCookie(next);
	writeEmbeddingsCookie(next);
	writeAgeCookie(next);
	writePayoutCookie(next);
	globalThis.dispatchEvent?.(new CustomEvent(DEV_SEAM_EVENT, { detail: next }));
}

/**
 * Mirror the age axis into the `pj.dev.age` cookie — the channel that reaches the API routes' age
 * mirror. Written while simulation is on and the axis is not `auto`; removed otherwise.
 */
function writeAgeCookie(next: DevOverrides): void {
	document.cookie = next.enabled && next.ageRestriction !== "auto"
		? `${AGE_OVERRIDE_COOKIE}=${next.ageRestriction}; path=/; samesite=lax`
		: `${AGE_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

function writePayoutCookie(next: DevOverrides): void {
	document.cookie = next.enabled && next.payoutReadiness !== "auto"
		? `${PAYOUT_OVERRIDE_COOKIE}=${next.payoutReadiness}; path=/; samesite=lax`
		: `${PAYOUT_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

function writeEmbeddingsCookie(next: DevOverrides): void {
	document.cookie = next.enabled && next.embeddings !== "auto"
		? `${EMBEDDINGS_OVERRIDE_COOKIE}=${next.embeddings}; path=/; samesite=lax`
		: `${EMBEDDINGS_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Mirror the discovery cold-start pair into the `pj.dev.discovery` cookie — the only channel that
 * reaches `/explore`'s SERVER-composed personal and Trending rails. Written while simulation is on and
 * an axis is not `auto`; removed otherwise. The server reads it only in development.
 */
function writeDiscoveryCookie(next: DevOverrides): void {
	const value = next.enabled
		? encodeDiscoverySim({ viewer: next.discoveryViewer, activity: next.discoveryActivity })
		: null;
	document.cookie = value
		? `${DISCOVERY_SIM_COOKIE}=${encodeURIComponent(value)}; path=/; samesite=lax`
		: `${DISCOVERY_SIM_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Mirror the landing pair into the `pj.dev.landing` cookie — the only channel that reaches the
 * SERVER-side dispatch of `/projects/[slug]` (Decision #144). Written while simulation is on and an axis
 * is not `auto`; removed otherwise, so switching simulation off restores the real dispatch on the next
 * request. The server reads it only in development.
 */
function writeLandingCookie(next: DevOverrides): void {
	const value = next.enabled
		? encodeLandingSim({
			access: next.projectAccess === "auto" ? null : next.projectAccess,
			status: next.projectStatus === "auto" ? null : next.projectStatus,
		})
		: null;
	document.cookie = value
		? `${LANDING_SIM_COOKIE}=${encodeURIComponent(value)}; path=/; samesite=lax`
		: `${LANDING_SIM_COOKIE}=; path=/; max-age=0; samesite=lax`;
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
	const restricted = o.ageRestriction === "auto" ? base.restricted : o.ageRestriction === "minor";

	return { ...base, contextType, role, isClient, isFreelancer, restricted };
}

/** The ownership override (`true`/`false`) when simulation is on, else `null` (defer to the real value). */
export function devOwnerOverride(): boolean | null {
	const o = devOverrides.value;
	return o.enabled ? o.isOwner : null;
}
// #endregion
