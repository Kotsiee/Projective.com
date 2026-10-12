/**
 * dev-seam.ts — the SHIPPING-SAFE read side of the Developer-Tools context seam.
 *
 * The DEV-ONLY Context Switcher (`apps/web/features/devtools/`, excluded from production builds)
 * publishes the developer's simulated persona two decoupled ways:
 *   1. a set of `data-dev-*` attributes on `<html>` (`data-dev-persona` / `data-dev-role` /
 *      `data-dev-entity` / `data-dev-owner`), and
 *   2. a {@link DEV_SEAM_EVENT} `CustomEvent` fired on every change.
 *
 * This module is the READ side any *shipping* surface (e.g. the `/projects` feed island) uses to
 * react to that override **without importing the build-excluded devtools code** — a direct import
 * would drag `features/devtools/*` back into the production island bundle and break the guardrail.
 * The two sides share only the attribute/event *contract*, never a module.
 *
 * Production safety: every entry point is gated on {@link IS_DEV} (Vite's statically-replaced
 * `import.meta.env.DEV`), so the whole module tree-shakes out of the production bundle — and the seam
 * is never written there anyway (nothing sets `data-dev-*`), so every read degrades to "no override".
 * Reading it grants no access; it only changes what the developer's own browser draws.
 */

import type { AutoFundMode, FundingState } from "@projective/types/finance";
import type {
	DiscoveryActivitySim,
	DiscoveryViewerSim,
	EmbeddingsOverride,
} from "@projective/types/explore";
import { IS_DEV } from "./dev.ts";

// #region Contract
/** The persona / account type the Context Switcher can simulate (mirrors devtools `DevAccountType`). */
export type DevPersona = "client" | "freelancer" | "team" | "business";
/** The team/business role view the Context Switcher can simulate (mirrors devtools `DevRole`). */
export type DevSeamRole = "admin" | "manager" | "worker" | "guest";

/** The engagement delivery format the Context Switcher can simulate (drives submission ticket handling). */
export type DevProjectType = "pipeline" | "one_off" | "session";
/**
 * The service delivery model the Context Switcher can simulate — a NEW axis, orthogonal to
 * {@link DevProjectType}, that discriminates the three engagement archetypes whose channel structure +
 * sidebar layout + channel-header tab set differ (task §2/§3):
 *
 * - `standard_project` — a stage-based project/service (the existing behaviour: stage channels, the
 *   Tasks + Submissions tabs, no Calendar tab).
 * - `normal_session` — a 1-1 session service: General channels only, a mini-calendar + upcoming-session
 *   sidebar, the Calendar tab (no stage channels, Tasks, or Submissions).
 * - `group_session` — a multi-client course/seminar: General + proficiency/breakout sub-groups + DMs,
 *   the Calendar tab, group voting/schedule signals (no Tasks or Submissions).
 */
export type DevServiceType = "standard_project" | "normal_session" | "group_session";
/**
 * The booking state of the acting session engagement's next slot (task §4) — drives the upcoming-session
 * widget's proposal badge: a confirmed slot, or a proposal awaiting the other party (proposed by the
 * client, or proposed by the freelancer/provider).
 */
export type DevSessionBookingStatus = "confirmed" | "client_proposed" | "freelancer_proposed";
/**
 * The acting-member view the Context Switcher can simulate for the Members tab (task §4) — the four
 * access conditions the roster rules branch on: a managing seat (Owner/Admin · Manager) vs a hired
 * contributor who is assigned to the routed stage or not.
 */
export type DevMemberRole =
	| "owner_admin"
	| "manager"
	| "freelancer_assigned"
	| "freelancer_unassigned";
/**
 * The acting inbox view the Context Switcher can simulate for `/messages` (task §4) — selects which
 * advanced-filter SET the sidebar shows and whether auto-responses are offered: a `freelancer` sees
 * provider-side filters (Service · Product · Client · Co-Freelancers · Teams · Team Members) and
 * auto-responses; a `client`/`business` buyer sees buyer-side filters (Businesses · Business Members ·
 * Hired Freelancers · Direct Messages).
 */
export type DevMessagingRole = "freelancer" | "client" | "business";
/** Whether the simulated freelancer is assigned to the active stage (drives stage-tab visibility). */
export type DevStageAssignment = "assigned" | "unassigned";
/** The lifecycle state of the simulated freelancer's active submission (drives the action state machine). */
export type DevSubmissionState = "draft" | "submitted" | "approved" | "revision_requested";
/**
 * The post-onboarding immutability position the Context Switcher can simulate for the project setup
 * surface (`/projects/[projectId]`).
 *
 * Once a freelancer is onboarded onto a project its Project-type control locks; once one is onboarded
 * onto a STAGE, that stage's ticket price locks. Both counts are SERVER-derived facts read from
 * `projects.stage_assignments`, so a developer cannot reach either locked state by using the form —
 * they would have to genuinely onboard somebody — which is the gap this axis exists to close.
 *
 * `first_stage` is the value that earns the axis its keep: it is the only one that PROVES the price
 * lock is per stage rather than per project, because a per-stage lock and a project-wide one are
 * indistinguishable on a project whose every stage is onboarded.
 */
export type DevProjectOnboarding = "auto" | "none" | "first_stage" | "all_stages";

/**
 * The microphone permission the Context Switcher can simulate for the chat composer's voice memo.
 * `auto` defers to the real device; the rest reach states that would otherwise need the developer to
 * change real browser settings and reload — a persistent block (`denied`), a browser without
 * `MediaRecorder` (`unsupported`), and the slow-grant window (`prompt`, which holds the connecting
 * state long enough to see) — so every capture branch is exercisable at runtime.
 *
 * Simulating `granted` never fabricates audio: it only skips the simulated delay and still asks the
 * real device, because a fake recording would prove nothing about the recorder.
 */
export type DevMicPermission = "auto" | "prompt" | "granted" | "denied" | "unsupported";

/** The document layout direction the Context Switcher can simulate (RtL/LtR verification, independent of language). */
export type DevLayoutDirection = "ltr" | "rtl" | "auto";

/**
 * The simulated setup position of the viewer's own profile — the header account popover's completion
 * ring, its next-step call to action and its presence pip. `auto` defers to the real
 * `GET /api/user/setup` read. The rest substitute what `org.fn_compute_profile_setup_progress` would
 * answer (Decision #155 — the rule lives in SQL, so a simulation substitutes its RESULT):
 *  - `new` — a finished sign-up: 40%, the photo next.
 *  - `live` — photo and story added: 80%, the working hours next.
 *  - `complete` — 100%, with Mon–Fri 9:00–17:30 published hours in the browser's own zone, so the
 *    pip and its tooltip have a real schedule to derive from.
 *
 * Its own axis because each value is a SERVER fact about stored profile data that no control on the
 * header can change, and a seeded persona sits at one position only.
 */
export type DevProfileSetup = "auto" | "new" | "live" | "complete";

/**
 * The simulated verification stamp (Decision #155) — the crest in the account popover and on the
 * profile hero, and the milestone celebration a raise fires. `auto` shows the stored stamp. Its own
 * axis because KYC, payout and KYB outcomes are written only by provider webhooks.
 */
export type DevVerificationStamp = "auto" | "none" | "id_verified" | "vault_verified" | "corporate_verified";

/**
 * The simulated earned trust signals on the profile hero (Decision #155): `auto` shows the stored
 * signals, `none` an empty record, `earned` three first-tier signals, `top` three top-tier ones. Its
 * own axis because every signal is derived from months of delivery history.
 */
export type DevTrustAdornments = "auto" | "none" | "earned" | "top";

/**
 * The simulated per-ticket funding state on the funding status line (Decision #165,
 * `PRODUCT_MANAGEMENT.md` §3.6): `auto` shows the server's `deriveFundingState`; any other value renders
 * that state with the card's real amount. Its own axis because a hold, a refused hold and a pending card
 * payment are server facts no page control reaches without moving money.
 */
export type DevFundingState = "auto" | FundingState;

/**
 * The simulated revision allotment on the submission review (Decision #167): `auto` shows the stage's
 * real terms; `exhausted` uses up the free rounds so "Request revision" becomes "Buy a revision · price";
 * `paid` puts a funded paid round on the active unit, so the freelancer sees "Paid revision, funded, you
 * can start." Its own axis because the count is consumed only by real reviews and a paid round only by a
 * real payment. Client-side: the server still answers from the real allotment.
 */
export type DevRevisionAllotment = "auto" | "exhausted" | "paid";

/**
 * The simulated session state (Decision #171) — the facts a session's surfaces branch on that only a
 * real booking, a real clock or the auto-release sweep can produce: `seat_full` fills the listing's
 * cohort (Reserve seat becomes "Cohort full"); `live` puts the next sitting in progress (join window
 * open); `ended` puts every sitting behind it; `release_pending` holds the seat's escrow inside the
 * 24-hour negative-consent window. `auto` shows the server's answer. Client-side only: the database
 * still refuses a full cohort and withholds a join URL outside its window.
 */
export type DevSessionState = "auto" | "seat_full" | "live" | "ended" | "release_pending";

/**
 * The simulated business auto-fund mode (PRODUCT_SPEC §Escrow, Wallets & Finance #4): `auto` shows the
 * business's real setting; any mode renders the Billing module as if it were set, and `from_wallet`
 * previews a funded ticket's "Auto-funded from wallet" line. Its own axis because the real mode acts
 * only when a ticket enters Needs funding — a refused hold — which no page control reaches. Client-side:
 * the server still auto-funds from the stored mode.
 */
export type DevAutoFundMode = "auto" | AutoFundMode;

/**
 * The simulated low-balance state on the Billing module: `auto` compares the real balance with the real
 * floor; `below` shows the low-balance warning, `above` hides it. Its own axis because crossing the
 * floor means spending real money. Client-side: notifications still come from real debits.
 */
export type DevLowBalance = "auto" | "below" | "above";

/**
 * The simulated notification inbox (DESIGN_SYSTEM §D.9): `empty` answers no notifications at all;
 * `many` answers a large unread set spread over every inbox category (tab counts, paging, bulk
 * select); `burst` keeps the real inbox and lands a run of new arrivals a second apart (the live
 * merge, the header dot and the rate-limited announcement). `auto` shows the real inbox. Client-side
 * only: the thin `NotificationService` substitutes its answers; nothing is written to the server.
 */
export type DevNotifications = "auto" | "empty" | "many" | "burst";

/**
 * The simulated basket (the header drawer and its switcher): `empty` answers a basket with no lines;
 * `multi_owner` adds a team and a business account, each with a basket and a list, to the switcher;
 * `unavailable` marks the first line no longer buyable. `auto` shows the real basket. Client-side
 * only: the drawer substitutes its read; every write still goes to the server.
 */
export type DevBasketScenario = "auto" | "empty" | "multi_owner" | "unavailable";

/**
 * The Explore Home's dismissible promo slots: `visible` ignores this device's stored dismissals,
 * `dismissed` hides every dismissible slot as if each had been dismissed. `auto` reads the stored
 * dismissals. Client-side only; the audience gate (a freelancer never sees "Become a Freelancer")
 * follows the persona axis, not this one.
 */
export type DevPromoDismissal = "auto" | "visible" | "dismissed";

/**
 * The Explore Home's discovery cold start, viewer half: `no_history` drops the viewer's views, saves
 * and affinity, so "Because you viewed" falls back to "Picked for you" from their stated interests;
 * `no_signals` drops those too, leaving only the shared rails. `auto` reads the real history.
 * SERVER-side: the switcher mirrors it into the `pj.dev.discovery` cookie
 * (`features/explore/core/discovery-sim.ts`) and `/explore` re-renders.
 */
export type DevDiscoveryViewer = DiscoveryViewerSim;

/**
 * The platform half: `quiet` ignores Trending's activity so the rail falls back to "New on
 * Projective". Server-side, through the same cookie.
 */
export type DevDiscoveryActivity = DiscoveryActivitySim;

/**
 * Discovery's embeddings switch (Decision #179): `auto` follows `EMBEDDINGS_ENABLED`; `on` / `off`
 * override it for this browser. SERVER-side: the switcher mirrors it into the `pj.dev.embeddings`
 * cookie, which only a development build reads, and a discovery page reloads to apply it. Turning it
 * on still needs `VOYAGE_API_KEY`.
 */
export type DevEmbeddings = "auto" | EmbeddingsOverride;

/**
 * How the `/wallet` hero's live aurora is chosen. `auto` runs the shipping gates (reduced motion, data
 * saver, device memory, core count, page visibility) and the performance watchdog; `static` never
 * mounts the canvas, so the resting CSS gradient is what shows; `animated` skips the hardware and
 * data-saver gates and the watchdog so the shader can be exercised on any machine, while still
 * honouring reduced motion and pausing on a hidden page.
 *
 * Its own axis because every non-`auto` value is a DEVICE fact (core count, memory, frame times) a
 * developer cannot change from the page.
 */
export type DevWalletAurora = "auto" | "static" | "animated";

/**
 * The `/settings` attention dashboard and the lane's marks (Decision #150). `auto` shows the real
 * facts; `clear` substitutes a fully set-up freelancer; `all` trips every attention rule once (an
 * unverified identity, no payout account, an unverified business, an expired connector, an unconfirmed
 * email). The FACTS are faked — `attentionItems`, the shipping rule, still decides what shows.
 */
export type DevSettingsAttention = "auto" | "clear" | "all";

/**
 * Settings → Account's lifecycle (Decision #156). `auto` shows the real reads; the others substitute
 * the handle policy (inside its correction window, or locked for 90 days) or the lifecycle (a
 * freelancer removal or an account deletion scheduled). The ANSWERS are faked — nothing is written.
 */
export type DevAccountLifecycle =
	| "auto"
	| "handle-window"
	| "handle-locked"
	| "removal-scheduled"
	| "deletion-scheduled";

/**
 * The proposal allowance (Decision #154) — the account popover's meter, the conversion lane's
 * disclosure and the apply modal's pre-flight notice. `auto` shows the real read; every other value
 * substitutes the STATUS those surfaces render, so the shipping copy, countdown and gate run on it:
 * `healthy` (plenty left), `low` (≤ 5 weekly — the upgrade link), `paced` (no buffer token, enforced:
 * submit disabled, live countdown), `paced_soft` (no buffer token while enforcement is off — the
 * notice says it still goes through), `weekly` (the week spent, enforced) and `team_small` (a
 * one-member team). Client-side only: the server's gate still answers from the real allowance.
 *
 * Its own axis because each value is a metered SERVER fact (tokens spent, a drip clock, a roster) that
 * no page control can reach without spending real proposals.
 */
export type DevProposalAllowance =
	| "auto"
	| "healthy"
	| "low"
	| "paced"
	| "paced_soft"
	| "weekly"
	| "team_small";

/** The DOM event the Context Switcher dispatches whenever the active override changes. */
export const DEV_SEAM_EVENT = "pj:devcontext";

/** A snapshot of the active persona override, decoded from the `<html data-dev-*>` seam. */
export interface DevSeamState {
	/** Always `true` here — the seam is only present while an override is active. */
	enabled: boolean;
	/** The simulated persona / account type. */
	persona: DevPersona;
	/** The simulated team/business role. */
	role: DevSeamRole;
	/** The simulated active entity (a workspace id or handle); `""` when unset (auto-derive). */
	entity: string;
	/** The simulated entity-ownership flag. */
	isOwner: boolean;
	/** The simulated engagement delivery format (submissions ticket handling + create-modal shape). */
	projectType: DevProjectType;
	/** The simulated service delivery model (standard project vs 1-1 / group session). */
	serviceType: DevServiceType;
	/** The booking state of the simulated session's next slot (session upcoming-session widget). */
	sessionBookingStatus: DevSessionBookingStatus;
	/** Whether the simulated viewer belongs to several sub-groups in a group session (task §4). */
	multiSubGroup: boolean;
	/** Whether the simulated freelancer is assigned to the active stage (stage-tab visibility). */
	stageAssignment: DevStageAssignment;
	/** The lifecycle state of the simulated freelancer's active submission (action state machine). */
	submissionState: DevSubmissionState;
	/** Whether the client has defined stage/ticket tasks (drives the Tasks panel toggle visibility). */
	hasTasks: boolean;
	/** The simulated onboarded-provider position driving the setup surface's post-onboarding locks. */
	projectOnboarding: DevProjectOnboarding;
	/** The simulated Members-tab acting role/assignment (task §4). */
	memberRole: DevMemberRole;
	/** Whether the Members tab should surface a pending-invitation queue (task §4). */
	pendingInvites: boolean;
	/** Whether the Members tab's Requests section should carry open applications. */
	pendingRequests: boolean;
	/** The simulated `/messages` inbox view (selects the advanced-filter set + auto-response offer). */
	messagingRole: DevMessagingRole;
	/** The simulated microphone permission for the chat composer's voice memo. */
	micPermission: DevMicPermission;
	/** The simulated document layout direction (RtL/LtR). */
	layoutDirection: DevLayoutDirection;
	/** The simulated setup position of the viewer's own profile (account popover ring + nudge + pip). */
	profileSetup: DevProfileSetup;
	/**
	 * How the `/wallet` hero's live aurora is chosen (gated · forced static · forced animated).
	 * `readDevSeam` always fills it; it is optional so hand-built seam fixtures need not, and absent
	 * reads as `auto`.
	 */
	walletAurora?: DevWalletAurora;
	/** The simulated settings attention facts. Optional like `walletAurora`; absent reads as `auto`. */
	settingsAttention?: DevSettingsAttention;
	/** The simulated account lifecycle. Optional like `walletAurora`; absent reads as `auto`. */
	accountLifecycle?: DevAccountLifecycle;
	/** The simulated proposal allowance. Optional like `walletAurora`; absent reads as `auto`. */
	proposalAllowance?: DevProposalAllowance;
	/** The simulated verification stamp. Optional like `walletAurora`; absent reads as `auto`. */
	verificationStamp?: DevVerificationStamp;
	/** The simulated trust signals. Optional like `walletAurora`; absent reads as `auto`. */
	trustAdornments?: DevTrustAdornments;
	/** The simulated ticket funding state. Optional like `walletAurora`; absent reads as `auto`. */
	fundingState?: DevFundingState;
	/** The simulated revision allotment. Optional like `walletAurora`; absent reads as `auto`. */
	revisionAllotment?: DevRevisionAllotment;
	/** The simulated business auto-fund mode. Optional like `walletAurora`; absent reads as `auto`. */
	autoFundMode?: DevAutoFundMode;
	/** The simulated low-balance state. Optional like `walletAurora`; absent reads as `auto`. */
	lowBalance?: DevLowBalance;
	/** The simulated session state. Optional like `walletAurora`; absent reads as `auto`. */
	sessionState?: DevSessionState;
	/** The simulated notification inbox. Optional like `walletAurora`; absent reads as `auto`. */
	notifications?: DevNotifications;
	/** The simulated basket. Optional like `walletAurora`; absent reads as `auto`. */
	basketScenario?: DevBasketScenario;
	/** The simulated promo dismissals. Optional like `walletAurora`; absent reads as `auto`. */
	promoDismissal?: DevPromoDismissal;
	/** The simulated discovery viewer cold start. Optional like `walletAurora`; absent reads as `auto`. */
	discoveryViewer?: DevDiscoveryViewer;
	/** The simulated discovery activity cold start. Optional like `walletAurora`; absent reads as `auto`. */
	discoveryActivity?: DevDiscoveryActivity;
	/** The embeddings switch override. Optional like `walletAurora`; absent reads as `auto`. */
	embeddings?: DevEmbeddings;
}
// #endregion

// #region Persona capabilities (single source of truth)
/** The capability flags a simulated persona resolves to. */
export interface PersonaCapabilities {
	/** Acts in a client / buyer capacity (owns / commissions engagements). */
	isClient: boolean;
	/** Can offer / deliver services (freelancer / seller capability). */
	isFreelancer: boolean;
}

/**
 * The one place that maps a {@link DevPersona} to its capability flags. Consumed by the devtools
 * `applyDevContext` (chrome deriver) AND by the `/projects` seam consumer, so both agree.
 *
 * A **business is buyer-only** (`isFreelancer: false`) — consistent with the platform's client/buyer
 * Organisation & Business rule (root `CLAUDE.md` Decisions #9/#10/#16): an individual client and a
 * business both act only in an owner/client capacity, whereas a freelancer and a team can also deliver
 * services. This drives the `/projects` Projects/Services tabs and the ownership role toggle.
 */
export function personaCapabilities(persona: DevPersona): PersonaCapabilities {
	switch (persona) {
		case "freelancer":
			return { isClient: false, isFreelancer: true };
		case "team":
			return { isClient: true, isFreelancer: true };
		case "business":
			return { isClient: true, isFreelancer: false };
		case "client":
		default:
			return { isClient: true, isFreelancer: false };
	}
}

/**
 * Whether a persona can offer/deliver services — i.e. whether the `/projects` lane should show the
 * Projects/Services tab split and the ownership role toggle (freelancer/team) or hide them
 * (client/business). Shorthand for `personaCapabilities(persona).isFreelancer`.
 */
export function personaCanProvide(persona: DevPersona): boolean {
	return personaCapabilities(persona).isFreelancer;
}
// #endregion

// #region Read side
const PERSONAS: readonly DevPersona[] = ["client", "freelancer", "team", "business"];
const ROLES: readonly DevSeamRole[] = ["admin", "manager", "worker", "guest"];
const PROJECT_TYPES: readonly DevProjectType[] = ["pipeline", "one_off", "session"];
const SERVICE_TYPES: readonly DevServiceType[] = [
	"standard_project",
	"normal_session",
	"group_session",
];
const BOOKING_STATUSES: readonly DevSessionBookingStatus[] = [
	"confirmed",
	"client_proposed",
	"freelancer_proposed",
];
const MEMBER_ROLES: readonly DevMemberRole[] = [
	"owner_admin",
	"manager",
	"freelancer_assigned",
	"freelancer_unassigned",
];
const STAGE_ASSIGNMENTS: readonly DevStageAssignment[] = ["assigned", "unassigned"];
const MESSAGING_ROLES: readonly DevMessagingRole[] = ["freelancer", "client", "business"];
const MIC_PERMISSIONS: readonly DevMicPermission[] = [
	"auto",
	"prompt",
	"granted",
	"denied",
	"unsupported",
];
const SUBMISSION_STATES: readonly DevSubmissionState[] = [
	"draft",
	"submitted",
	"approved",
	"revision_requested",
];
const PROJECT_ONBOARDINGS: readonly DevProjectOnboarding[] = [
	"auto",
	"none",
	"first_stage",
	"all_stages",
];
const LAYOUT_DIRECTIONS: readonly DevLayoutDirection[] = ["ltr", "rtl", "auto"];
const PROFILE_SETUPS: readonly DevProfileSetup[] = ["auto", "new", "live", "complete"];
const WALLET_AURORAS: readonly DevWalletAurora[] = ["auto", "static", "animated"];
const SETTINGS_ATTENTIONS: readonly DevSettingsAttention[] = ["auto", "clear", "all"];
const ACCOUNT_LIFECYCLES: readonly DevAccountLifecycle[] = [
	"auto",
	"handle-window",
	"handle-locked",
	"removal-scheduled",
	"deletion-scheduled",
];
const PROPOSAL_ALLOWANCES: readonly DevProposalAllowance[] = [
	"auto",
	"healthy",
	"low",
	"paced",
	"paced_soft",
	"weekly",
	"team_small",
];
const VERIFICATION_STAMPS: readonly DevVerificationStamp[] = [
	"auto",
	"none",
	"id_verified",
	"vault_verified",
	"corporate_verified",
];
const TRUST_ADORNMENTS: readonly DevTrustAdornments[] = ["auto", "none", "earned", "top"];
const FUNDING_STATES: readonly DevFundingState[] = [
	"auto",
	"draft",
	"needs_funding",
	"processing",
	"funded",
	"in_progress",
	"in_review",
	"released",
	"failed",
	"refunded",
];

const REVISION_ALLOTMENTS: readonly DevRevisionAllotment[] = ["auto", "exhausted", "paid"];
const SESSION_STATES: readonly DevSessionState[] = ["auto", "seat_full", "live", "ended", "release_pending"];
const AUTO_FUND_MODES: readonly DevAutoFundMode[] = ["auto", "off", "add_to_basket", "from_wallet"];
const LOW_BALANCES: readonly DevLowBalance[] = ["auto", "below", "above"];
const NOTIFICATION_SIMS: readonly DevNotifications[] = ["auto", "empty", "many", "burst"];
const BASKET_SCENARIOS: readonly DevBasketScenario[] = ["auto", "empty", "multi_owner", "unavailable"];
const PROMO_DISMISSALS: readonly DevPromoDismissal[] = ["auto", "visible", "dismissed"];
const DISCOVERY_VIEWERS: readonly DevDiscoveryViewer[] = ["auto", "no_history", "no_signals"];
const DISCOVERY_ACTIVITIES: readonly DevDiscoveryActivity[] = ["auto", "quiet"];
const EMBEDDINGS_MODES: readonly DevEmbeddings[] = ["auto", "on", "off"];

/** Coerce a raw attribute value against an allowed set, falling back when absent/unknown. */
function coerce<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
	return raw && (allowed as readonly string[]).includes(raw) ? raw as T : fallback;
}

/**
 * Read the active persona override from the `<html data-dev-*>` seam, or `null` when no override is
 * active (the seam is absent), when there is no DOM (SSR), or in production. Pure — safe to call on
 * mount and from an event handler.
 */
export function readDevSeam(): DevSeamState | null {
	if (!IS_DEV || typeof document === "undefined") return null;
	const ds = document.documentElement.dataset;
	// The switcher only writes `data-dev-persona` while an override is enabled, so its presence is the
	// enabled signal; its absence means "use the real session".
	if (!ds.devPersona) return null;
	return {
		enabled: true,
		persona: coerce(ds.devPersona, PERSONAS, "client"),
		role: coerce(ds.devRole, ROLES, "worker"),
		entity: ds.devEntity ?? "",
		isOwner: ds.devOwner === "true",
		projectType: coerce(ds.devProjectType, PROJECT_TYPES, "pipeline"),
		serviceType: coerce(ds.devServiceType, SERVICE_TYPES, "standard_project"),
		sessionBookingStatus: coerce(ds.devSessionBooking, BOOKING_STATUSES, "confirmed"),
		multiSubGroup: ds.devMultiSubgroup === "true",
		stageAssignment: coerce(ds.devStageAssignment, STAGE_ASSIGNMENTS, "assigned"),
		submissionState: coerce(ds.devSubmissionState, SUBMISSION_STATES, "draft"),
		hasTasks: ds.devHasTasks !== "false",
		// The `auto` fallback is load-bearing, not incidental: it makes an ABSENT attribute decode
		// identically to an explicit `auto`, which is what lets the write side omit the attribute
		// entirely while the axis is inert (see `reflect()` in `devtools/core/dev-context.ts`).
		projectOnboarding: coerce(ds.devProjectOnboarding, PROJECT_ONBOARDINGS, "auto"),
		memberRole: coerce(ds.devMemberRole, MEMBER_ROLES, "owner_admin"),
		pendingInvites: ds.devPendingInvites !== "false",
		pendingRequests: ds.devPendingRequests !== "false",
		messagingRole: coerce(ds.devMessagingRole, MESSAGING_ROLES, "freelancer"),
		micPermission: coerce(ds.devMicPermission, MIC_PERMISSIONS, "auto"),
		layoutDirection: coerce(ds.devDirection, LAYOUT_DIRECTIONS, "ltr"),
		// Absent = `auto`, the same "no second spelling for no override" rule as `projectOnboarding`.
		profileSetup: coerce(ds.devProfileSetup, PROFILE_SETUPS, "auto"),
		// Absent = `auto` here too.
		walletAurora: coerce(ds.devWalletAurora, WALLET_AURORAS, "auto"),
		settingsAttention: coerce(ds.devSettingsAttention, SETTINGS_ATTENTIONS, "auto"),
		accountLifecycle: coerce(ds.devAccountLifecycle, ACCOUNT_LIFECYCLES, "auto"),
		proposalAllowance: coerce(ds.devProposalAllowance, PROPOSAL_ALLOWANCES, "auto"),
		verificationStamp: coerce(ds.devVerificationStamp, VERIFICATION_STAMPS, "auto"),
		trustAdornments: coerce(ds.devTrustAdornments, TRUST_ADORNMENTS, "auto"),
		fundingState: coerce(ds.devFundingState, FUNDING_STATES, "auto"),
		revisionAllotment: coerce(ds.devRevisionAllotment, REVISION_ALLOTMENTS, "auto"),
		autoFundMode: coerce(ds.devAutoFundMode, AUTO_FUND_MODES, "auto"),
		lowBalance: coerce(ds.devLowBalance, LOW_BALANCES, "auto"),
		sessionState: coerce(ds.devSessionState, SESSION_STATES, "auto"),
		notifications: coerce(ds.devNotifications, NOTIFICATION_SIMS, "auto"),
		basketScenario: coerce(ds.devBasketScenario, BASKET_SCENARIOS, "auto"),
		promoDismissal: coerce(ds.devPromoDismissal, PROMO_DISMISSALS, "auto"),
		discoveryViewer: coerce(ds.devDiscoveryViewer, DISCOVERY_VIEWERS, "auto"),
		discoveryActivity: coerce(ds.devDiscoveryActivity, DISCOVERY_ACTIVITIES, "auto"),
		embeddings: coerce(ds.devEmbeddings, EMBEDDINGS_MODES, "auto"),
	};
}

/**
 * Subscribe to persona-override changes (the {@link DEV_SEAM_EVENT}). The callback receives the
 * decoded {@link DevSeamState} (or `null` when the override was turned off). Returns an unsubscribe
 * function. A no-op returning a no-op in production / without a DOM, so no listener is ever retained
 * there.
 */
export function subscribeDevSeam(fn: (state: DevSeamState | null) => void): () => void {
	if (!IS_DEV || typeof globalThis.addEventListener !== "function") return () => {};
	const handler = () => fn(readDevSeam());
	globalThis.addEventListener(DEV_SEAM_EVENT, handler as EventListener);
	return () => globalThis.removeEventListener(DEV_SEAM_EVENT, handler as EventListener);
}
// #endregion
