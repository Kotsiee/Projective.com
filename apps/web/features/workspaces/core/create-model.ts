import {
	kindCopy,
	readTeamPersonaDetails,
	WORKSPACE_HANDLE_MAX,
	WORKSPACE_NAME_MAX,
	WORKSPACE_NAME_MIN,
	type WorkspaceKind,
} from "@projective/types/workspace";
import {
	type PayoutGateDetails,
	readPayoutGateDetails,
	readPlanGateDetails,
} from "@projective/types/finance";
import type {
	ButtonNeutralTone,
	ButtonSemanticTone,
	ButtonStructuralTone,
} from "@ui/fields/types/button.ts";
import { type HandleCheckState, handleReady, handleSuggestions } from "./handle-check.ts";

/**
 * create-model — every rule the Draft-First create dialog renders, as pure functions.
 *
 * The dialog (`islands/CreateWorkspaceModal.island.tsx`) is a binding over these: which kind it
 * creates (its route's — it never asks), what its two fields accept, when its one commit opens, which
 * buttons its regions hold and at what tier (and so with which Button tone), what the handle's live
 * line says and when, and how a refusal from the create door is worded and fixed.
 * Keeping them here is what lets the acceptance rules — one filled control, the gate, the refusal
 * routing — be tested without a DOM, and keeps `/businesses` (which shares the dialog, Decision #61)
 * on the same rules as `/teams`.
 */

// #region Copy
/** The dialog's words for one kind. */
export interface CreateCopy {
	/** The dialog title. */
	header: string;
	/** The commit button's label at rest. */
	submit: string;
	/** The commit button's label while the create is in flight. */
	submitting: string;
	/** The one line under the title: what the kind is, and that it starts as a draft. */
	intro: string;
	/** A placeholder name in the kind's register. */
	namePlaceholder: string;
	/**
	 * The handle field's placeholder. A business's is its name placeholder's own handle
	 * (`acme-studio`), so the two agree; a team's keeps R3's shorter `northern-grid`.
	 */
	handlePlaceholder: string;
}

/**
 * The placeholders per kind. A business's is deliberately NEUTRAL ("Acme Studio", BU1) — a
 * real-sounding firm in a hiring dialog reads like a suggestion, or like somebody else's company.
 */
const PLACEHOLDERS: Record<WorkspaceKind, { name: string; handle: string }> = {
	team: { name: "Northern Grid Collective", handle: "northern-grid" },
	business: { name: "Acme Studio", handle: "acme-studio" },
};

/** The dialog's copy: the title and the commit both name the route's kind. */
export function createCopy(kind: WorkspaceKind): CreateCopy {
	const copy = kindCopy(kind);
	return {
		header: `Create a ${copy.noun}`,
		submit: `Create ${copy.noun}`,
		submitting: "Creating…",
		intro: `${copy.pitch} It starts as a draft — you finish setting it up inside.`,
		namePlaceholder: PLACEHOLDERS[kind].name,
		handlePlaceholder: PLACEHOLDERS[kind].handle,
	};
}
// #endregion

// #region Fields
/**
 * What is wrong with a display name, or `null`. The bounds are `org.create_workspace`'s, pinned to it
 * by `workspace.contract.test.ts`; the name is trimmed first, as the database trims it.
 */
export function nameProblem(name: string): string | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return "Give it a name.";
	if (trimmed.length < WORKSPACE_NAME_MIN) {
		return `Names are at least ${WORKSPACE_NAME_MIN} characters.`;
	}
	if (trimmed.length > WORKSPACE_NAME_MAX) {
		return `Names are ${WORKSPACE_NAME_MAX} characters or fewer.`;
	}
	return null;
}

/**
 * The handle field's value as the reader typed it, lower-cased: a leading `@` (people type one) is
 * dropped and a space becomes a hyphen. Nothing else is rewritten — a character outside the charset
 * stays, so the claim rule can say why it is refused instead of the field silently eating keys.
 */
export function normalizeHandleInput(raw: string): string {
	return raw.toLowerCase().replace(/^@+/, "").replace(/\s+/g, "-");
}

/**
 * A legal handle derived from a display name, mirrored into the handle field until the reader takes
 * it over: accents folded, every run of other characters one hyphen, no hyphen at either end, within
 * {@link WORKSPACE_HANDLE_MAX}. It can still be short, reserved or taken — the check decides that.
 */
export function handleFromName(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, WORKSPACE_HANDLE_MAX)
		.replace(/-+$/, "");
}
// #endregion

// #region The commit gate
/** What the create commit is waiting on. */
export interface CreateGateInput {
	name: string;
	handle: HandleCheckState;
	submitting: boolean;
}

/**
 * Whether the create commit is enabled: a valid name, a handle the namespace has just said is
 * available, and no create already in flight.
 */
export function createGateOpen(input: CreateGateInput): boolean {
	return !input.submitting && nameProblem(input.name) === null && handleReady(input.handle);
}
// #endregion

// #region Actions and their tiers
/**
 * A button's tier in the Button Interaction Matrix (DESIGN_SYSTEM §B.8.1): 2 the monochrome
 * structural fill (primary creation), 4 the neutral outlined utility (a retry — "Try again" is the
 * matrix's own example), 5 a text button (Cancel, escape hatches, one-tap fixes). The dialog uses no
 * other tier.
 */
export type CreateTier = 2 | 4 | 5;

/** The Button tone props one tier renders with — exactly one of the ui's colour-ramp contracts. */
export type CreateTierProps = ButtonStructuralTone | ButtonNeutralTone | ButtonSemanticTone;

/**
 * The Button props a tier renders with. The dialog spreads this onto every Button it draws and spells
 * no tone of its own, so the tier a rule below assigns is the tier on screen.
 */
export function tierProps(tier: CreateTier): CreateTierProps {
	switch (tier) {
		case 2:
			return { structural: true };
		case 4:
			return { severity: "neutral", variant: "outlined" };
		case 5:
			return { variant: "text" };
	}
}

/** One button the dialog renders. */
export interface CreateAction {
	key: string;
	label: string;
	tier: CreateTier;
	disabled: boolean;
}

/** Whether a tier renders filled — judged on the props it renders with (`filled` is Button's default). */
export function isFilled(tier: CreateTier): boolean {
	return (tierProps(tier).variant ?? "filled") === "filled";
}

/** The footer: Cancel (tier 5), then the one structural commit (tier 2), gated. */
export function createFooterActions(kind: WorkspaceKind, gate: CreateGateInput): CreateAction[] {
	const copy = createCopy(kind);
	return [
		{ key: "cancel", label: "Cancel", tier: 5, disabled: false },
		{
			key: "create",
			label: gate.submitting ? copy.submitting : copy.submit,
			tier: 2,
			disabled: !createGateOpen(gate),
		},
	];
}

/** The one-tap alternatives under a taken handle — text buttons, never chips. */
export function suggestionActions(suggestions: readonly string[]): CreateAction[] {
	return suggestions.map((s) => ({
		key: `suggest:${s}`,
		label: `@${s}`,
		tier: 5,
		disabled: false,
	}));
}

/**
 * The retry under a probe that could not be answered — a utility, so tier 4 (§B.8.1 lists "Try
 * again" there), or `null` while there is nothing to retry.
 */
export function recheckAction(state: HandleCheckState): CreateAction | null {
	return state.failed ? { key: "recheck", label: "Check again", tier: 4, disabled: false } : null;
}

/** Every button the dialog renders in one state — what the one-filled-control rule is judged over. */
export function createDialogActions(
	kind: WorkspaceKind,
	gate: CreateGateInput,
	suggestions: readonly string[],
): CreateAction[] {
	const recheck = recheckAction(gate.handle);
	return [
		...suggestionActions(suggestions),
		...(recheck ? [recheck] : []),
		...createFooterActions(kind, gate),
	];
}
// #endregion

// #region The handle's live line
/** Where the reader is with the two fields — what decides who explains a refused handle. */
export interface HandleFieldPhase {
	/** The reader has left the name field at least once. */
	nameLeft: boolean;
	/** The reader has typed into the handle, so it no longer mirrors the name. */
	handleEdited: boolean;
	/** The handle field's own verdict is showing — the reader has left that field at least once. */
	handleRevealed: boolean;
}

/**
 * Whether the polite live line explains a refused handle. The handle field's own error row is §A.7's:
 * it paints only once the reader has left THAT field. A handle mirrored from the name may never be
 * visited at all, so until its field speaks for itself, the live line says why it cannot be had —
 * from the moment the reader leaves the name it came from, and without marking the field invalid
 * before they have had a turn in it.
 */
export function liveLineExplains(phase: HandleFieldPhase): boolean {
	return phase.nameLeft && !phase.handleEdited && !phase.handleRevealed;
}

/** What the live line says while a probe is pending — one fixed sentence, so it is announced once. */
export const HANDLE_CHECKING = "Checking…";

/** The live line's tone: what its leading mark draws. */
export type HandleLiveTone = "checking" | "available" | "refused" | "failed";

/** One state of the handle's polite live line. */
export interface HandleLiveLine {
	tone: HandleLiveTone;
	text: string;
}

/**
 * The live line for a check state, or `null` when it has nothing to say. It is a polite live region,
 * so every change of its text is read out: while a probe is pending it holds {@link HANDLE_CHECKING}
 * unchanged (the reducer enters `checking` on every keystroke, and echoing the handle would announce
 * each one); it names the handle only in a verdict, which arrives once per pause.
 */
export function handleLiveLine(
	state: HandleCheckState,
	phase: HandleFieldPhase,
): HandleLiveLine | null {
	switch (state.status) {
		case "checking":
			return { tone: "checking", text: HANDLE_CHECKING };
		case "available":
			return { tone: "available", text: `@${state.handle} is available` };
		case "taken":
		case "reserved":
		case "invalid":
			return liveLineExplains(phase) && state.reason
				? { tone: "refused", text: state.reason }
				: null;
		case "idle":
			return state.failed && state.reason ? { tone: "failed", text: state.reason } : null;
	}
}

/** The alternatives on show: a taken handle's, once either the field or the live line explains it. */
export function visibleSuggestions(
	state: HandleCheckState,
	phase: HandleFieldPhase,
): readonly string[] {
	return phase.handleRevealed || liveLineExplains(phase) ? handleSuggestions(state) : [];
}
// #endregion

// #region Keys
/** The parts of a keyboard event {@link isPlainEnter} reads. */
export interface EnterKeyInput {
	key: string;
	isComposing: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

/**
 * An Enter the form may claim: unmodified and not confirming an IME composition. The name field's
 * Enter walks forward to the handle — what its `enterKeyHint="next"` promises — and only the handle's
 * submits.
 */
export function isPlainEnter(event: EnterKeyInput): boolean {
	return event.key === "Enter" && !event.isComposing && !event.altKey && !event.ctrlKey &&
		!event.metaKey && !event.shiftKey;
}
// #endregion

// #region Refusals
/** A refused create, routed to the fix it needs. */
export type CreateRefusal =
	/** Teams are for freelancer accounts (Decision #228 (A)). No fix in this dialog. */
	| { reason: "persona"; message: string }
	/** The earning gate (Decision #196): verify and add a payout account — Settings → Verification. */
	| { reason: "payout"; message: string; details: PayoutGateDetails }
	/** The plan's ownership cap (`teams_owned` · `businesses_owned`): the plan page. */
	| { reason: "entitlement"; message: string; entitlement: string | null }
	/** The handle went between the check and the create: check it again. */
	| { reason: "handle"; message: string }
	/** Anything else, in the server's own words. */
	| { reason: "other"; message: string };

/** The fallback sentence for a refusal that arrived with no words. */
export const CREATE_FAILED = "Could not create it — please try again.";

/** What a refused create answered with (`WorkspaceResult` minus its data). */
export interface CreateFailure {
	message?: string;
	errors?: Record<string, string>;
	details?: unknown;
}

/**
 * Route a refused create to its fix by the typed `details` the create door answers with — never by
 * parsing the sentence. Order matters only for robustness: each gate's details are distinct.
 */
export function classifyCreateRefusal(res: CreateFailure): CreateRefusal {
	const message = res.message?.trim() || CREATE_FAILED;
	if (readTeamPersonaDetails(res.details)) return { reason: "persona", message };
	const payout = readPayoutGateDetails(res.details);
	if (payout) return { reason: "payout", message, details: payout };
	const plan = readPlanGateDetails(res.details);
	if (plan) return { reason: "entitlement", message, entitlement: plan.entitlement };
	const handle = res.errors?.handle;
	if (handle) return { reason: "handle", message: handle };
	return { reason: "other", message: res.errors?.name ?? message };
}
// #endregion
