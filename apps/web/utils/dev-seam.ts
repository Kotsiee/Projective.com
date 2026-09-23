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
 * The entity kind the Context Switcher can simulate for `/teams` and `/businesses` — a **Team is a
 * Freelancer with multiple members**, a **Business is a Client with multiple members**, so this axis
 * selects which side of the market the whole console is parameterised to.
 */
export type DevWorkspaceKind = "team" | "business";
/**
 * The role the simulated viewer holds inside the acting entity, driving the capability-gated lane nav,
 * the module permission gate, and every row action. `non_member` is included deliberately: it is the
 * only way to exercise the "somebody who does not belong here" path at runtime.
 */
export type DevWorkspaceRole = "owner" | "admin" | "lead" | "member" | "non_member";
/**
 * Where the simulated viewer stands relative to the entity. `invited` and `requested` are distinct
 * because they route to opposite actions — one owes them a decision, the other owes us one.
 */
export type DevMembershipState = "active" | "invited" | "requested";
/**
 * The entity's verification state — a team verifies its members (KYC) to be paid, a business verifies
 * the company (KYB) to operate its pooled wallet. Drives the locked-but-actionable gate.
 */
export type DevWorkspaceVerification = "unverified" | "kyb_pending" | "verified";
/**
 * The shape of the viewer's roster, so the selling empty state and the one-person-team pre-state (legal,
 * but cannot bid) are both reachable without editing fixtures.
 */
export type DevRosterState = "populated" | "empty" | "single";

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
	/** The simulated `/messages` inbox view (selects the advanced-filter set + auto-response offer). */
	messagingRole: DevMessagingRole;
	/** The simulated microphone permission for the chat composer's voice memo. */
	micPermission: DevMicPermission;
	/** The simulated entity kind for the `/teams` · `/businesses` console. */
	workspaceKind: DevWorkspaceKind;
	/** The simulated role the viewer holds inside the acting entity (incl. `non_member`). */
	workspaceRole: DevWorkspaceRole;
	/** The simulated membership state (active / invited / requested). */
	membershipState: DevMembershipState;
	/** The simulated entity verification state (drives the KYC/KYB lock). */
	workspaceVerification: DevWorkspaceVerification;
	/** Whether the session is simulated as ACTING as the entity rather than personally. */
	actingContext: boolean;
	/** The simulated roster shape (populated / empty / a single one-person entity). */
	rosterState: DevRosterState;
	/** The simulated document layout direction (RtL/LtR). */
	layoutDirection: DevLayoutDirection;
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
const WORKSPACE_KINDS: readonly DevWorkspaceKind[] = ["team", "business"];
const WORKSPACE_ROLES: readonly DevWorkspaceRole[] = [
	"owner",
	"admin",
	"lead",
	"member",
	"non_member",
];
const MEMBERSHIP_STATES: readonly DevMembershipState[] = ["active", "invited", "requested"];
const WORKSPACE_VERIFICATIONS: readonly DevWorkspaceVerification[] = [
	"unverified",
	"kyb_pending",
	"verified",
];
const ROSTER_STATES: readonly DevRosterState[] = ["populated", "empty", "single"];
const LAYOUT_DIRECTIONS: readonly DevLayoutDirection[] = ["ltr", "rtl", "auto"];

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
		messagingRole: coerce(ds.devMessagingRole, MESSAGING_ROLES, "freelancer"),
		micPermission: coerce(ds.devMicPermission, MIC_PERMISSIONS, "auto"),
		workspaceKind: coerce(ds.devWorkspaceKind, WORKSPACE_KINDS, "team"),
		workspaceRole: coerce(ds.devWorkspaceRole, WORKSPACE_ROLES, "admin"),
		membershipState: coerce(ds.devMembershipState, MEMBERSHIP_STATES, "active"),
		workspaceVerification: coerce(
			ds.devWorkspaceVerification,
			WORKSPACE_VERIFICATIONS,
			"verified",
		),
		actingContext: ds.devActingContext === "true",
		rosterState: coerce(ds.devRosterState, ROSTER_STATES, "populated"),
		layoutDirection: coerce(ds.devDirection, LAYOUT_DIRECTIONS, "ltr"),
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
