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
	type DevDisplayCurrency,
	type DevLayoutDirection,
	type DevMemberRole,
	type DevMessagingRole,
	type DevPersona,
	type DevProjectType,
	type DevSeamRole,
	type DevServiceType,
	type DevSessionBookingStatus,
	type DevStageAssignment,
	type DevSubmissionState,
	type DevWalletFundMix,
	type DevWalletKyc,
	type DevWalletSmoother,
	type DevWalletVaultRole,
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
	DevDisplayCurrency,
	DevLayoutDirection,
	DevMemberRole,
	DevMessagingRole,
	DevProjectType,
	DevServiceType,
	DevSessionBookingStatus,
	DevStageAssignment,
	DevSubmissionState,
	DevWalletFundMix,
	DevWalletKyc,
	DevWalletSmoother,
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
	/** Simulated display currency — drives the fat service's conversion + `Intl` formatting (RtL-independent). */
	displayCurrency: DevDisplayCurrency;
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
	memberRole: "owner_admin",
	hasPendingInvites: true,
	messagingRole: "freelancer",
	walletVaultRole: "admin",
	walletKyc: "verified",
	walletSmoother: "enrolled",
	walletFundMix: "normal",
	displayCurrency: "GBP",
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

/** Display-currency options in display order. */
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
		root.dataset.devWalletRole = next.walletVaultRole;
		root.dataset.devWalletKyc = next.walletKyc;
		root.dataset.devWalletSmoother = next.walletSmoother;
		root.dataset.devWalletFundMix = next.walletFundMix;
		root.dataset.devDisplayCurrency = next.displayCurrency;
		root.dataset.devDirection = next.layoutDirection;
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
		delete root.dataset.devWalletRole;
		delete root.dataset.devWalletKyc;
		delete root.dataset.devWalletSmoother;
		delete root.dataset.devWalletFundMix;
		delete root.dataset.devDisplayCurrency;
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
