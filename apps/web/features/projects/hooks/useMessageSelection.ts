/// <reference lib="dom" />
import type { JSX, RefObject } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ChatMessage } from "../types/projects-types.ts";
import {
	type ChatSurface,
	MESSAGE_MENU_OPEN_EVENT,
	MESSAGE_REPLY_EVENT,
	type MessageMenuOpenDetail,
	type MessageReplyDetail,
} from "@web/utils/lane-events.ts";
import { isInteractiveTarget, isTypingKey, ownsKeys } from "../core/chat-keyboard.ts";
import {
	clipboardText,
	rangeIds,
	replyTargetOf,
	selectableIds,
	stepId,
	toggleId,
} from "../core/message-selection.ts";
import { makeId } from "../core/composer-model.ts";

/**
 * useMessageSelection — highlight mode for a message surface: the shared brain of the page feed
 * ({@link ChatFeed}) and the floating chat window ({@link PopoutChat}).
 *
 * ## What it governs
 *
 * - **Highlight mode.** Entered by a right-click on a message, by Up/Down with the composer
 *   unfocused, by a Ctrl/Shift-click, or by a long press on touch. While it is on, every message
 *   that is not selected or under the keyboard cursor is blurred (the CSS reads `data-msg-highlight`
 *   on the surface root), and the cursor's message shows its actions as a context menu. Escape, a
 *   plain click, or a press outside the surface leaves it.
 * - **Selection.** Ctrl-click toggles, Shift-click and Shift-arrow extend from the anchor, a plain
 *   arrow moves a single selection. A plain left click never highlights — it only sets the anchor the
 *   next arrow press starts from.
 * - **Shortcuts with the composer unfocused.** Left/Right reply to the one selected (or focused)
 *   message — never to several; Ctrl+C copies every selected message; Ctrl+Up/Down scroll the surface
 *   (held, they repeat). Typing leaves highlight mode; the composer takes the character itself.
 * - **Touch.** A horizontal swipe on a message replies to it; a long press selects it, opens the
 *   reaction bubble, and puts the surface in a tap-to-toggle selection mode whose actions the host
 *   renders in the header bar.
 *
 * The keyboard is claimed through {@link ownsKeys}, so a field, a menu, a dialog, or the OTHER chat
 * surface on the page keeps its keys. "One message menu at a time" is held across islands with
 * {@link MESSAGE_MENU_OPEN_EVENT}.
 *
 * The hook owns state and gestures only; it renders nothing. The host renders the rows with
 * {@link MessageSelection.rowFor}, the count bar, the header bar and the reaction bubble.
 */

// #region Tunables
/** A touch held this long without moving is a long press. */
const HOLD_MS = 450;
/** Movement under this (px) is still a press, not a drag. */
const SLOP_PX = 10;
/** A swipe past this (px, after resistance) replies on release. */
const SWIPE_TRIGGER_PX = 56;
/** The furthest a row follows the finger (px). */
const SWIPE_MAX_PX = 84;
/** How much of the finger's travel the row follows — the resistance that says "this has a limit". */
const SWIPE_RESISTANCE = 0.6;
/** One Ctrl+Arrow step (px); a held key repeats it at the OS repeat rate. */
const SCROLL_STEP_PX = 96;
// #endregion

// #region Types
export interface UseMessageSelectionOptions {
	surface: ChatSurface;
	/** The channel (or conversation) id — addresses the reply to the right composer. */
	channelId: string;
	/** The surface root. Its containment decides what an outside press is. */
	rootRef: RefObject<HTMLElement>;
	/** The loaded messages, oldest → newest. */
	messages: Signal<ChatMessage[]>;
	/** Bring a message into view (virtualizer-aware where the surface virtualizes). */
	reveal: (id: string) => void;
	/** Scroll the surface by `dy` px — the window for the page, the panel for the pop-out. */
	scrollBy: (dy: number) => void;
}

/** What one rendered row needs: its state, and the attributes + handlers to spread on `.msg-row`. */
export interface RowBinding {
	selected: boolean;
	focused: boolean;
	/** Whether this row's actions render as the highlight-mode context menu. */
	menu: boolean;
	attrs: {
		tabIndex: number;
		"data-message-id": string;
		"data-selected"?: "true";
		"data-focused"?: "true";
	};
	handlers: {
		onClick: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
		onMouseDown: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
		onContextMenu: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
		onPointerDown: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
		onPointerMove: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
		onPointerUp: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
		onPointerCancel: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
	};
}

export interface MessageSelection {
	/** Highlight mode is on. */
	active: Signal<boolean>;
	/** Selected ids, in feed order. */
	selected: Signal<string[]>;
	/** The keyboard cursor (and the context menu's row). */
	focusId: Signal<string | null>;
	/** Shift is held — the CSS un-blurs the hovered message while it is. */
	shift: Signal<boolean>;
	/** Selection was entered by touch: taps toggle, and the header bar carries the actions. */
	touch: Signal<boolean>;
	/** The message whose reaction bubble is open (touch long press), or null. */
	reactFor: Signal<string | null>;
	/** The polite live-region sentence for the last selection change. */
	status: Signal<string>;
	rowFor(m: ChatMessage): RowBinding;
	/** Leave highlight mode and clear the selection (the anchor survives). */
	exit(): void;
	/** Ask this surface's composer to reply to `m`, and leave highlight mode. */
	reply(m: ChatMessage): void;
	/** Copy the selection (or the given ids) to the clipboard. */
	copy(ids?: readonly string[]): Promise<void>;
	/** Toggle one message into / out of the selection (the header bar's per-row taps). */
	toggle(id: string): void;
}
// #endregion

export function useMessageSelection(options: UseMessageSelectionOptions): MessageSelection {
	// `channelId`, `reveal` and `scrollBy` are read through {@link live} at call time: the window
	// listeners are registered once, and must reach the latest closures rather than the first render's.
	const { surface, rootRef, messages } = options;

	// #region State
	const active = useSignal(false);
	const selected = useSignal<string[]>([]);
	const focusId = useSignal<string | null>(null);
	const shift = useSignal(false);
	const touch = useSignal(false);
	const reactFor = useSignal<string | null>(null);
	const status = useSignal("");
	/** Where a Shift-range starts, and where the first arrow press lands after a plain click. */
	const anchor = useRef<string | null>(null);
	/** This surface's token on {@link MESSAGE_MENU_OPEN_EVENT}. */
	const owner = useRef(makeId("msg-sel"));
	/** The latest options, read by the window listeners registered once. */
	const live = useRef(options);
	live.current = options;
	// #endregion

	// #region Helpers
	function byId(id: string | null): ChatMessage | undefined {
		return id ? messages.value.find((m) => m.id === id) : undefined;
	}

	function rowEl(id: string): HTMLElement | null {
		const root = rootRef.current;
		if (!root) return null;
		return root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
	}

	/**
	 * Move DOM focus onto the cursor row once it is rendered. A tick late on purpose: revealing a row
	 * the virtualizer had not drawn re-renders the window first, and focusing before that would focus
	 * nothing.
	 */
	function focusRow(id: string): void {
		live.current.reveal(id);
		setTimeout(() => rowEl(id)?.focus({ preventScroll: true }), 0);
	}

	function announce(text: string): void {
		status.value = text;
	}

	function describe(id: string, count: number): string {
		const m = byId(id);
		const who = m ? (m.isOwn ? "You" : m.sender?.name ?? "Unknown") : "Message";
		const what = m?.text.trim() ? m.text.trim().slice(0, 120) : "attachment";
		return count > 1 ? `${count} messages selected. ${who}: ${what}` : `${who}: ${what}`;
	}

	/** Announce the menu opening so every other message menu on the page closes. */
	function claimMenu(): void {
		globalThis.dispatchEvent(
			new CustomEvent<MessageMenuOpenDetail>(MESSAGE_MENU_OPEN_EVENT, {
				detail: { owner: owner.current },
			}),
		);
	}

	function enter(): void {
		if (!active.value) {
			active.value = true;
			claimMenu();
		}
	}

	function exit(): void {
		if (!active.value && selected.value.length === 0) return;
		active.value = false;
		selected.value = [];
		touch.value = false;
		reactFor.value = null;
		announce("Selection cleared.");
	}

	/** The messages a shortcut acts on: the selection, else the message row that holds focus. */
	function targets(): string[] {
		if (active.value && selected.value.length > 0) return selected.value;
		const focused = document.activeElement?.closest<HTMLElement>("[data-message-id]");
		if (focused && rootRef.current?.contains(focused)) {
			const id = focused.getAttribute("data-message-id");
			return id ? [id] : [];
		}
		return [];
	}
	// #endregion

	// #region Actions
	function reply(m: ChatMessage): void {
		globalThis.dispatchEvent(
			new CustomEvent<MessageReplyDetail>(MESSAGE_REPLY_EVENT, {
				detail: { channelId: live.current.channelId, surface, target: replyTargetOf(m) },
			}),
		);
		exit();
		announce(`Replying to ${m.isOwn ? "your message" : m.sender?.name ?? "a message"}.`);
	}

	async function copy(ids: readonly string[] = targets()): Promise<void> {
		if (ids.length === 0) return;
		try {
			await navigator.clipboard.writeText(clipboardText(messages.value, ids));
			announce(ids.length > 1 ? `Copied ${ids.length} messages.` : "Copied message.");
		} catch {
			announce("Your browser blocked the copy.");
		}
	}

	function toggle(id: string): void {
		const ids = selectableIds(messages.value);
		const next = toggleId(ids, selected.value, id);
		selected.value = next;
		reactFor.value = null;
		if (next.length === 0) {
			exit();
			return;
		}
		focusId.value = id;
		anchor.current = id;
		announce(describe(id, next.length));
	}

	/**
	 * Up/Down: enter on the anchor (or the newest message), then step; Shift extends the range.
	 * Resolves whether it acted — a feed with nothing to select leaves the arrows to the page.
	 */
	function navigate(direction: -1 | 1, extend: boolean): boolean {
		const ids = selectableIds(messages.value);
		if (ids.length === 0) return false;
		let next: string;
		if (!active.value) {
			const start = anchor.current && ids.includes(anchor.current)
				? anchor.current
				: ids[ids.length - 1];
			enter();
			next = start;
			anchor.current = start;
			selected.value = [start];
		} else {
			next = stepId(ids, focusId.value, direction) ?? ids[ids.length - 1];
			if (extend && anchor.current) {
				selected.value = rangeIds(ids, anchor.current, next);
			} else {
				anchor.current = next;
				selected.value = [next];
			}
		}
		touch.value = false;
		reactFor.value = null;
		focusId.value = next;
		focusRow(next);
		announce(describe(next, selected.value.length));
		return true;
	}

	/** Left/Right: reply to exactly one message; several is refused out loud rather than guessed. */
	function replyFromKeys(): boolean {
		const ids = targets();
		if (ids.length === 0) return false;
		if (ids.length > 1) {
			announce("Reply works on one message at a time.");
			return true;
		}
		const m = byId(ids[0]);
		if (!m || m.type !== "user") return false;
		reply(m);
		return true;
	}

	/** A long press (or a touch context menu): select this message and offer reactions. */
	function hold(m: ChatMessage): void {
		if (m.type !== "user") return;
		enter();
		touch.value = true;
		selected.value = [m.id];
		focusId.value = m.id;
		anchor.current = m.id;
		reactFor.value = m.id;
		try {
			navigator.vibrate?.(12);
		} catch { /* haptics unavailable — the visual change is the feedback */ }
		announce(describe(m.id, 1));
	}
	// #endregion

	// #region Window listeners (keyboard, outside press, other menus)
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent): void {
			// Only tracked while highlighting — it is all the un-blur reads, and a feed re-render on every
			// capital letter typed in the composer would be work for nothing.
			if (e.key === "Shift" && active.value) shift.value = true;
			// The element focused when the key was pressed — fixed at dispatch, unlike
			// `document.activeElement`, which the composer's own listener may already have moved.
			const activeEl = e.target instanceof Element ? e.target : document.activeElement;
			if (!ownsKeys(surface, activeEl)) return;

			// Typing leaves highlight mode; the composer takes the character on its own listener.
			// Checked before `defaultPrevented` because that listener prevents the default.
			if (isTypingKey(e)) {
				if (active.value && !(e.ctrlKey || e.metaKey)) exit();
				return;
			}
			if (e.defaultPrevented) return;

			const mod = e.ctrlKey || e.metaKey;
			if (e.key === "Escape") {
				if (active.value) {
					e.preventDefault();
					exit();
				}
				return;
			}
			if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
				e.preventDefault();
				live.current.scrollBy(e.key === "ArrowUp" ? -SCROLL_STEP_PX : SCROLL_STEP_PX);
				return;
			}
			if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
				// A text selection the reader dragged out is theirs to copy natively.
				const text = globalThis.getSelection?.();
				if (text && !text.isCollapsed && text.toString().trim().length > 0) return;
				const ids = targets();
				if (ids.length === 0) return;
				e.preventDefault();
				void copy(ids);
				return;
			}
			if (mod || e.altKey) return;
			if (e.key === "ArrowUp" || e.key === "ArrowDown") {
				if (navigate(e.key === "ArrowUp" ? -1 : 1, e.shiftKey)) e.preventDefault();
				return;
			}
			if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				if (replyFromKeys()) e.preventDefault();
			}
		}

		function onKeyUp(e: KeyboardEvent): void {
			if (e.key === "Shift" && shift.value) shift.value = false;
		}

		function onBlur(): void {
			if (shift.value) shift.value = false;
		}

		/**
		 * A press outside the surface leaves highlight mode — except on the surface's own floating
		 * pieces (the header bar, the reaction bubble, the context menu), which are portalled out of the
		 * root and mark themselves `data-msg-ui`, and on any portalled overlay a menu item opened.
		 */
		function onOutside(e: PointerEvent): void {
			if (!active.value) return;
			const target = e.target as Element | null;
			if (!target || rootRef.current?.contains(target)) return;
			if (target.closest("[data-msg-ui], [data-ui-portal], .ui-popover")) return;
			exit();
		}

		function onOtherMenu(e: Event): void {
			const detail = (e as CustomEvent<MessageMenuOpenDetail>).detail;
			if (detail?.owner !== owner.current && active.value) exit();
		}

		globalThis.addEventListener("keydown", onKeyDown);
		globalThis.addEventListener("keyup", onKeyUp);
		globalThis.addEventListener("blur", onBlur);
		document.addEventListener("pointerdown", onOutside, true);
		globalThis.addEventListener(MESSAGE_MENU_OPEN_EVENT, onOtherMenu);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
			globalThis.removeEventListener("keyup", onKeyUp);
			globalThis.removeEventListener("blur", onBlur);
			document.removeEventListener("pointerdown", onOutside, true);
			globalThis.removeEventListener(MESSAGE_MENU_OPEN_EVENT, onOtherMenu);
		};
	}, [surface]);

	// A message that left the loaded list cannot stay selected.
	useEffect(() => {
		if (selected.value.length === 0) return;
		const present = new Set(messages.value.map((m) => m.id));
		const kept = selected.value.filter((id) => present.has(id));
		if (kept.length !== selected.value.length) {
			selected.value = kept;
			if (kept.length === 0) exit();
		}
	}, [messages.value]);
	// #endregion

	// #region Touch gestures
	/**
	 * The one gesture in flight. A ref, not a signal: it changes on every pointer move, and nothing
	 * renders from it — the row follows the finger through a CSS custom property written straight on
	 * the element, so a swipe costs no re-render of the feed.
	 */
	const gesture = useRef<
		{
			id: string;
			el: HTMLElement;
			pointerId: number;
			x: number;
			y: number;
			swiping: boolean;
			armed: boolean;
			held: boolean;
			timer: number;
		} | null
	>(null);
	/** Swallow the click a long press or a swipe ends with, so it does not also toggle the row. */
	const swallowClick = useRef(0);

	function resetSwipe(el: HTMLElement): void {
		el.removeAttribute("data-swiping");
		el.removeAttribute("data-swipe-armed");
		el.removeAttribute("data-swipe-dir");
		el.style.removeProperty("--msg-swipe");
	}

	function endGesture(commit: boolean): void {
		const g = gesture.current;
		if (!g) return;
		clearTimeout(g.timer);
		gesture.current = null;
		resetSwipe(g.el);
		if (g.held || g.swiping) swallowClick.current = Date.now();
		if (commit && g.armed) {
			const m = byId(g.id);
			if (m) reply(m);
		}
	}
	// #endregion

	// #region Row binding
	function rowFor(m: ChatMessage): RowBinding {
		const isSelected = selected.value.includes(m.id);
		const isFocused = active.value && focusId.value === m.id;
		const authored = m.type === "user";
		return {
			selected: isSelected,
			focused: isFocused,
			menu: authored && isFocused && !touch.value,
			attrs: {
				tabIndex: -1,
				"data-message-id": m.id,
				"data-selected": isSelected ? "true" : undefined,
				"data-focused": isFocused ? "true" : undefined,
			},
			handlers: {
				onMouseDown(e) {
					// Ctrl/Shift-clicking a message selects it; the browser's own reading of those
					// gestures (extend a text selection, start a drag) must not happen underneath.
					if ((e.shiftKey || e.ctrlKey || e.metaKey) && !isInteractiveTarget(e.target)) {
						e.preventDefault();
					}
				},
				onClick(e) {
					if (Date.now() - swallowClick.current < 450) return;
					if (!authored) return;
					if (isInteractiveTarget(e.target)) {
						anchor.current = m.id;
						return;
					}
					const ids = selectableIds(messages.value);
					if (e.ctrlKey || e.metaKey) {
						enter();
						touch.value = false;
						toggle(m.id);
						if (selected.value.length > 0) focusRow(m.id);
						return;
					}
					if (e.shiftKey) {
						enter();
						touch.value = false;
						const from = anchor.current && ids.includes(anchor.current) ? anchor.current : m.id;
						const span = rangeIds(ids, from, m.id);
						selected.value = ids.filter((x) => selected.value.includes(x) || span.includes(x));
						focusId.value = m.id;
						focusRow(m.id);
						announce(describe(m.id, selected.value.length));
						return;
					}
					// A tap while touch-selecting adds or removes the message, as on a phone's inbox.
					if (active.value && touch.value) {
						toggle(m.id);
						return;
					}
					// A plain click never highlights: it only marks where the next arrow press starts.
					if (active.value) exit();
					anchor.current = m.id;
				},
				onContextMenu(e) {
					e.preventDefault();
					if (!authored) return;
					// A long press on Android arrives as a context menu too; it is the same gesture.
					const g = gesture.current;
					if (g?.el === e.currentTarget || touch.value) {
						if (g && !g.held) {
							clearTimeout(g.timer);
							g.held = true;
							hold(m);
						}
						return;
					}
					enter();
					touch.value = false;
					reactFor.value = null;
					if (!selected.value.includes(m.id)) selected.value = [m.id];
					focusId.value = m.id;
					anchor.current = m.id;
					claimMenu();
					focusRow(m.id);
					announce(describe(m.id, selected.value.length));
				},
				onPointerDown(e) {
					if (e.pointerType !== "touch" || !authored || isInteractiveTarget(e.target)) return;
					endGesture(false);
					const el = e.currentTarget;
					gesture.current = {
						id: m.id,
						el,
						pointerId: e.pointerId,
						x: e.clientX,
						y: e.clientY,
						swiping: false,
						armed: false,
						held: false,
						timer: setTimeout(() => {
							const g = gesture.current;
							if (!g || g.id !== m.id || g.swiping) return;
							g.held = true;
							hold(m);
						}, HOLD_MS) as unknown as number,
					};
				},
				onPointerMove(e) {
					const g = gesture.current;
					if (!g || g.pointerId !== e.pointerId || g.held) return;
					const dx = e.clientX - g.x;
					const dy = e.clientY - g.y;
					if (!g.swiping) {
						if (Math.abs(dy) > SLOP_PX && Math.abs(dy) >= Math.abs(dx)) {
							endGesture(false);
							return;
						}
						if (Math.abs(dx) <= SLOP_PX) return;
						g.swiping = true;
						clearTimeout(g.timer);
						g.el.setAttribute("data-swiping", "true");
					}
					const travel = Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx * SWIPE_RESISTANCE));
					g.el.style.setProperty("--msg-swipe", `${travel}px`);
					g.el.setAttribute("data-swipe-dir", travel >= 0 ? "start" : "end");
					const armed = Math.abs(travel) >= SWIPE_TRIGGER_PX;
					if (armed !== g.armed) {
						g.armed = armed;
						if (armed) {
							g.el.setAttribute("data-swipe-armed", "true");
							try {
								navigator.vibrate?.(8);
							} catch { /* no haptics */ }
						} else g.el.removeAttribute("data-swipe-armed");
					}
				},
				onPointerUp(e) {
					if (gesture.current?.pointerId === e.pointerId) endGesture(true);
				},
				onPointerCancel(e) {
					if (gesture.current?.pointerId === e.pointerId) endGesture(false);
				},
			},
		};
	}
	// #endregion

	return {
		active,
		selected,
		focusId,
		shift,
		touch,
		reactFor,
		status,
		rowFor,
		exit,
		reply,
		copy,
		toggle,
	};
}
