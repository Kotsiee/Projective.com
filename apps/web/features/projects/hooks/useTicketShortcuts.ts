import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { isEditableTarget } from "@features/shell/core/shortcuts.ts";
import { shortcutOn } from "@features/shortcuts/core/shortcut-registry.ts";
import {
	isSaveShortcut,
	newTicketChordOf,
	steppedTab,
	ticketTabNumberOf,
	ticketTabStepOf,
} from "../core/ticket-keyboard.ts";

// #region Ticket modal
/** What {@link useTicketShortcuts} reads at each keystroke: the latest render's values. */
export interface TicketShortcutOptions<T extends string> {
	/** Whether the ticket is the top layer. Every shortcut sleeps beneath a dialog, menu or picker. */
	active: boolean;
	/** The visible tabs, in strip order. */
	tabs: readonly { key: T }[];
	current: T;
	onTab: (key: T) => void;
	/** The tab strip, so a switch made from a focused tab takes focus with it. */
	tablistRef: RefObject<HTMLElement>;
	/** Save the working copy, or create the ticket. Called once per press, never for a held key. */
	onSave: () => void;
}

const PENDING_INLINE_EDIT = ".ui-inline-edit__input";

/**
 * useTicketShortcuts — the ticket modal's keys: Ctrl/⌘+1–9 opens the tab at that position (from
 * inside a field too), Ctrl/⌘+← / → steps through the tabs and wraps (never inside a field, where
 * the chord moves the caret), and Ctrl/⌘+S saves or creates. Ctrl/⌘+S always suppresses the
 * browser's Save Page dialog while the ticket is on top, as `useSaveShortcut` does on the setup
 * forms. A half-typed inline edit (the title) is committed by its blur before the save reads the
 * working copy.
 */
export function useTicketShortcuts<T extends string>(opts: TicketShortcutOptions<T>): void {
	const latest = useRef(opts);
	latest.current = opts;

	useEffect(() => {
		const focusTabAt = (index: number) => {
			const strip = latest.current.tablistRef.current;
			const tabs = strip?.querySelectorAll<HTMLElement>('[role="tab"]');
			tabs?.[index]?.focus();
		};

		const go = (index: number) => {
			const o = latest.current;
			const next = o.tabs[index];
			if (!next) return;
			const fromStrip = !!o.tablistRef.current?.contains(document.activeElement);
			if (next.key !== o.current) o.onTab(next.key);
			if (fromStrip) focusTabAt(index);
		};

		const save = () => {
			const field = document.activeElement;
			if (field instanceof HTMLElement && field.matches(PENDING_INLINE_EDIT)) field.blur();
			setTimeout(() => latest.current.onSave(), 0);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			const o = latest.current;
			if (!o.active || event.defaultPrevented || event.isComposing) return;

			if (isSaveShortcut(event)) {
				if (!shortcutOn("save")) return;
				event.preventDefault();
				if (!event.repeat) save();
				return;
			}

			const number = ticketTabNumberOf(event);
			if (number !== null) {
				if (!shortcutOn("ticket-switch-tab") || number >= o.tabs.length) return;
				event.preventDefault();
				go(number);
				return;
			}

			const step = ticketTabStepOf(event);
			if (step === 0 || !shortcutOn("ticket-cycle-tabs")) return;
			const target = event.target instanceof Element ? event.target : null;
			if (isEditableTarget(target)) return;
			const at = o.tabs.findIndex((t) => t.key === o.current);
			event.preventDefault();
			go(steppedTab(at, step, o.tabs.length));
		};

		globalThis.addEventListener("keydown", onKeyDown);
		return () => globalThis.removeEventListener("keydown", onKeyDown);
	}, []);
}
// #endregion

// #region Project board
/** What {@link useNewTicketShortcut} reads at each keystroke. */
export interface NewTicketShortcutOptions {
	/** Whether the viewer may start a ticket here now: the gate the board's own New ticket draws. */
	canCreate: () => boolean;
	onCreate: () => void;
}

const OPEN_OVERLAY = "[aria-modal='true'], dialog[open]";
const INSIDE_OVERLAY = "[role='menu'], [role='listbox'], [role='dialog'], [role='alertdialog']";

/**
 * useNewTicketShortcut — `N` opens a new ticket on the board, outside fields, menus and dialogs.
 * Ctrl/⌘+N does the same where the browser hands it to the page; most keep it for a new window.
 */
export function useNewTicketShortcut(opts: NewTicketShortcutOptions): void {
	const latest = useRef(opts);
	latest.current = opts;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			const chord = newTicketChordOf(event);
			if (!chord || !shortcutOn("board-new-ticket")) return;
			const target = event.target instanceof Element ? event.target : null;
			if (chord === "bare" && isEditableTarget(target)) return;
			if (target?.closest(INSIDE_OVERLAY) || document.querySelector(OPEN_OVERLAY)) return;
			if (!latest.current.canCreate()) return;
			event.preventDefault();
			latest.current.onCreate();
		};

		globalThis.addEventListener("keydown", onKeyDown);
		return () => globalThis.removeEventListener("keydown", onKeyDown);
	}, []);
}
// #endregion
