import { batch, signal } from "@preact/signals";
import type { WorkspaceMember } from "@projective/types/workspace";
import {
	contextPanelInflow,
	selectionPanelOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import { memberSearch } from "./member-inspector-model.ts";

/**
 * member-inspector-state — the bridge between the Members body (table, cards, org chart) and the
 * member inspector in the middle-nav panel, two hydration roots (Decision #322).
 *
 * {@link selectedMember} is the one selection: a pick docks the inspector from 1280px
 * (`selectionPanelOpen`) or slides it over below that ({@link memberSheetOpen}); every close — the
 * inspector's own Close, Escape, the sheet's dismissal, dragging the docked panel shut — clears it.
 * The address mirrors it as `?member=<handle>` with `replaceState`, as the surface's `?view=` is.
 */

// #region State
/** The handle of the member the inspector shows, or `null` while nobody is selected. */
export const selectedMember = signal<string | null>(null);

/** The slide-over inspector is open (below 1280px). */
export const memberSheetOpen = signal(false);

/** The inspector shows the edit form rather than the dossier. */
export const memberEditing = signal(false);

/** A terminal act the inspector hands to the Members body, which owns its confirmation dialog. */
export interface MemberActRequest {
	act: "transfer" | "leave" | "remove";
	memberId: string;
	/** The slide-over was closing as it asked, so the dialog waits for it to leave. */
	fromSheet: boolean;
	/** A pulse — a repeated request for the same act still differs. */
	seq: number;
}

/** The latest terminal act asked for, or `null`. */
export const memberActRequest = signal<MemberActRequest | null>(null);

let opener: { element: HTMLElement | null; memberId: string } | null = null;
// #endregion

// #region Address
function writeAddress(handle: string | null): void {
	const location = globalThis.location;
	const history = globalThis.history;
	if (!location || !history) return;
	try {
		history.replaceState(
			history.state,
			"",
			`${location.pathname}${memberSearch(location.search, handle)}${location.hash}`,
		);
	} catch { /* an address that cannot be rewritten still leaves the inspector on the selection */ }
}
// #endregion

// #region Select and clear
function show(): void {
	if (contextPanelInflow()) selectionPanelOpen.value = true;
	else memberSheetOpen.value = true;
}

/**
 * Select a member: the inspector opens on them in whichever form the viewport presents it, and what
 * had focus is remembered so a close can hand it back.
 */
export function selectMember(member: Pick<WorkspaceMember, "id" | "handle">): void {
	const active = globalThis.document?.activeElement;
	const element = active instanceof HTMLElement && active !== globalThis.document.body
		? active
		: null;
	if (!opener || !element?.closest(".wsp-inspector")) opener = { element, memberId: member.id };
	batch(() => {
		if (selectedMember.peek() !== member.handle) memberEditing.value = false;
		selectedMember.value = member.handle;
		show();
	});
	writeAddress(member.handle);
}

/** Adopt the member the server resolved from the address, without rewriting it. */
export function adoptAddressedMember(handle: string): void {
	batch(() => {
		selectedMember.value = handle;
		show();
	});
}

/** Close the inspector in every form, drop `?member=`, and return focus to what opened it. */
export function clearSelectedMember(refocus = true): void {
	const had = selectedMember.peek() !== null;
	batch(() => {
		selectedMember.value = null;
		memberEditing.value = false;
		selectionPanelOpen.value = false;
		memberSheetOpen.value = false;
	});
	writeAddress(null);
	if (had && refocus) setTimeout(refocusMemberOpener, 0);
}

/** Re-present the open selection after the viewport crosses 1280px. */
export function representSelection(inflow: boolean): void {
	if (selectedMember.peek() === null) return;
	batch(() => {
		selectionPanelOpen.value = inflow;
		memberSheetOpen.value = !inflow;
	});
}

/**
 * Focus what opened the inspector — the element focused at the pick, else the member's table row,
 * card or chart node (a menu item that opened it is gone by now).
 */
export function refocusMemberOpener(): void {
	const was = opener;
	opener = null;
	if (!was) return;
	if (was.element?.isConnected) {
		was.element.focus({ preventScroll: true });
		return;
	}
	const id = CSS.escape(was.memberId);
	globalThis.document?.querySelector<HTMLElement | SVGElement>(
		`.wsp-members [data-key="${id}"], .wsp-members [data-id="${id}"]`,
	)?.focus({ preventScroll: true });
}
// #endregion

// #region Terminal acts
/** Ask the Members body to confirm a terminal act on a member. */
export function requestMemberAct(
	act: MemberActRequest["act"],
	memberId: string,
	fromSheet: boolean,
): void {
	memberActRequest.value = { act, memberId, fromSheet, seq: (memberActRequest.peek()?.seq ?? 0) + 1 };
}
// #endregion
