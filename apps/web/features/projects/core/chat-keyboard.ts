/// <reference lib="dom" />
import type { ChatSurface } from "@web/utils/lane-events.ts";

/**
 * chat-keyboard — who owns a keystroke on a page that has a chat on it.
 *
 * The chat surfaces listen on `window`, not on an element, because their whole point is to act when
 * NOTHING of theirs has focus: typing with the composer unfocused lands in the composer, and the arrow
 * keys walk the messages while the caret is nowhere. A window listener hears every key on the page,
 * so the difficult half is refusing correctly — never stealing a key from a field, a menu, a slider,
 * a dialog or a focused button, and never letting the page's chat answer a key meant for the pop-out
 * window floating over it (or the reverse). Every rule lives here so the composer and the two feeds
 * cannot disagree about it.
 *
 * Territory is decided by DOM containment of the focused element: a key belongs to the `popout`
 * surface when focus is inside the floating window, and to the `page` surface otherwise. A message
 * row is focusable (`tabindex="-1"`), so clicking a message inside the window is what moves the
 * keyboard into it.
 */

// #region Selectors
/** Anything that accepts typed text. A key pressed here belongs to it, full stop. */
const EDITABLE = [
	"input",
	"textarea",
	"select",
	"[contenteditable='']",
	"[contenteditable='true']",
	"[contenteditable='plaintext-only']",
].join(",");

/**
 * Widgets that own the arrow keys (and usually typeahead) for themselves. Focus anywhere inside one
 * means the key is theirs, even though the focused node is not editable.
 */
const COMPOSITE = [
	"[role='menu']",
	"[role='menubar']",
	"[role='listbox']",
	"[role='tree']",
	"[role='treegrid']",
	"[role='grid']",
	"[role='tablist']",
	"[role='radiogroup']",
	"[role='slider']",
	"[role='spinbutton']",
	"[role='combobox']",
	"[role='toolbar']",
	"[aria-modal='true']",
	"dialog[open]",
].join(",");

/** Controls that Space or Enter activates — those two keys must reach them, not the composer. */
const ACTIVATABLE = [
	"button",
	"a[href]",
	"summary",
	"label",
	"[role='button']",
	"[role='link']",
	"[role='checkbox']",
	"[role='switch']",
	"[role='menuitem']",
	"[role='option']",
	"[role='tab']",
].join(",");

/** The floating chat window's roots — the pop-out popover and the profile messenger's sheet. */
const POPOUT_ROOT = "[data-chat-surface='popout'], .chat-popout";
// #endregion

// #region Predicates
/** Whether the element (or an ancestor) accepts typed text. */
export function isEditable(el: Element | null): boolean {
	return !!el?.closest(EDITABLE);
}

/** Whether the element sits inside a widget that owns its own arrow keys. */
export function inCompositeWidget(el: Element | null): boolean {
	return !!el?.closest(COMPOSITE);
}

/** Which chat surface a focused element belongs to. */
export function surfaceOf(el: Element | null): ChatSurface {
	return el?.closest(POPOUT_ROOT) ? "popout" : "page";
}

/** Whether a modal layer is open anywhere — the page's chat stands down entirely while it is. */
function modalOpen(): boolean {
	return !!document.querySelector("[aria-modal='true'], dialog[open]");
}

/**
 * Whether `surface` may act on a key pressed while `active` has focus.
 *
 * Refuses whenever the focused element types for itself or owns its arrows. The page surface also
 * refuses while a modal is open (its keys belong to the modal even with focus on `body`) and while
 * focus is inside the pop-out window; the pop-out surface acts only while focus is inside it.
 */
export function ownsKeys(surface: ChatSurface, active: Element | null): boolean {
	if (isEditable(active) || inCompositeWidget(active)) return false;
	if (surface === "popout") return surfaceOf(active) === "popout";
	return surfaceOf(active) === "page" && !modalOpen();
}

/**
 * Whether a keydown is ordinary typing — one printed character, no shortcut modifier.
 *
 * AltGr arrives as Ctrl+Alt on Windows, and it is how `@`, `€` or `{` is typed on many layouts, so
 * it counts as typing; a dead key or an IME composition has no single-character `key` and is left
 * alone rather than half-captured.
 */
export function isTypingKey(event: KeyboardEvent): boolean {
	if (event.isComposing || event.key.length !== 1) return false;
	if (event.metaKey) return false;
	const altGraph = event.getModifierState?.("AltGraph") ?? false;
	if ((event.ctrlKey || event.altKey) && !altGraph) return false;
	return true;
}

/**
 * Whether the composer may take this typed key from `active`.
 *
 * Space and Enter on a focused button or link are activations, not typing, so they stay with the
 * control. Every other printed character is free to move: a reader who clicked a nav link and then
 * starts writing meant the message box.
 */
export function composerMayTake(event: KeyboardEvent, active: Element | null): boolean {
	if (event.key === " " && active?.closest(ACTIVATABLE)) return false;
	return true;
}

/**
 * Whether a pointer or key event came from a control INSIDE a message — a link, a button, a media
 * player — which must keep doing its own job rather than select the message it sits in.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
	return target instanceof Element &&
		!!target.closest("a[href], button, input, textarea, select, audio, video, [role='button']");
}
// #endregion
