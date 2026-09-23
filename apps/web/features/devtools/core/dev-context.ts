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
	type DevLayoutDirection,
	type DevMemberRole,
	type DevMembershipState,
	type DevMessagingRole,
	type DevMicPermission,
	type DevPersona,
	type DevProjectOnboarding,
	type DevProjectType,
	type DevRosterState,
	type DevSeamRole,
	type DevServiceType,
	type DevSessionBookingStatus,
	type DevStageAssignment,
	type DevSubmissionState,
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
	DevLayoutDirection,
	DevMemberRole,
	DevMessagingRole,
	DevMicPermission,
	DevProjectType,
	DevServiceType,
	DevSessionBookingStatus,
	DevStageAssignment,
	DevSubmissionState,
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
	/** Simulated document layout direction (LtR/RtL) — verifies the whole surface mirrors under `dir="rtl"`. */
	layoutDirection: DevLayoutDirection;
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
	memberRole: "owner_admin",
	hasPendingInvites: true,
	messagingRole: "freelancer",
	micPermission: "auto",
	workspaceKind: "team",
	workspaceRole: "admin",
	membershipState: "active",
	workspaceVerification: "verified",
	actingContext: false,
	rosterState: "populated",
	layoutDirection: "ltr",
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

/** Layout-direction options in display order (LtR/RtL). */
export const DEV_LAYOUT_DIRECTIONS: ReadonlyArray<DevOption<DevLayoutDirection>> = [
	{ value: "ltr", label: "LtR" },
	{ value: "rtl", label: "RtL" },
	{ value: "auto", label: "Auto" },
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
		root.dataset.devMemberRole = next.memberRole;
		root.dataset.devPendingInvites = String(next.hasPendingInvites);
		root.dataset.devMessagingRole = next.messagingRole;
		root.dataset.devMicPermission = next.micPermission;
		root.dataset.devWorkspaceKind = next.workspaceKind;
		root.dataset.devWorkspaceRole = next.workspaceRole;
		root.dataset.devMembershipState = next.membershipState;
		root.dataset.devWorkspaceVerification = next.workspaceVerification;
		root.dataset.devActingContext = String(next.actingContext);
		root.dataset.devRosterState = next.rosterState;
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
		delete root.dataset.devMemberRole;
		delete root.dataset.devPendingInvites;
		delete root.dataset.devMessagingRole;
		delete root.dataset.devMicPermission;
		delete root.dataset.devWorkspaceKind;
		delete root.dataset.devWorkspaceRole;
		delete root.dataset.devMembershipState;
		delete root.dataset.devWorkspaceVerification;
		delete root.dataset.devActingContext;
		delete root.dataset.devRosterState;
		delete root.dataset.devDirection;
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
