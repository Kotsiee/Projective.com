/**
 * shortcuts — the shell's global keyboard shortcuts, as pure predicates over the parts of a
 * `KeyboardEvent` they read, so the rules are testable without a DOM.
 */

/** The parts of a `KeyboardEvent` a shortcut rule reads. */
export interface ShortcutKey {
	key: string;
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	repeat: boolean;
	defaultPrevented: boolean;
}

/** The parts of an event target the editable test reads. */
export interface ShortcutTarget {
	tagName?: string;
	isContentEditable?: boolean;
	closest?: (selector: string) => unknown;
}

const EDITABLE_SELECTOR =
	"input, textarea, select, [contenteditable]:not([contenteditable='false']), .ui-rte";

/**
 * Whether a keystroke at `target` belongs to what the viewer is typing into — a field, a select, a
 * content-editable region, or anywhere inside a rich-text editor (where Ctrl/Cmd+B means bold).
 */
export function isEditableTarget(target: ShortcutTarget | null | undefined): boolean {
	if (!target) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName?.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	return typeof target.closest === "function" && target.closest(EDITABLE_SELECTOR) != null;
}

/**
 * Ctrl+B or Cmd+B with no other modifier — the global sidebar toggle. A key that already reached a
 * handler, or one held down, never fires it. Matches the B key on non-Latin layouts by its position.
 */
export function isToggleSidebarShortcut(event: ShortcutKey): boolean {
	if (event.defaultPrevented || event.repeat || event.shiftKey || event.altKey) return false;
	if (event.ctrlKey === event.metaKey) return false;
	const key = event.key.toLowerCase();
	return key === "b" || (!/^[a-z]$/.test(key) && event.code === "KeyB");
}

/**
 * A bare `/` — "focus this page's search", or the header's where the page has none. Shift is allowed
 * because some layouts type `/` with it; any command modifier is not, so `Cmd+/` and friends stay
 * free, and `Cmd+K` remains reserved for the platform command palette. The caller must still skip
 * {@link isEditableTarget} targets: a `/` typed into a field is text.
 */
export function isFocusSearchShortcut(event: ShortcutKey): boolean {
	if (event.defaultPrevented || event.repeat) return false;
	if (event.ctrlKey || event.metaKey || event.altKey) return false;
	return event.key === "/";
}

/**
 * Ctrl+/ or Cmd+/ (exactly one) — "focus the site header's search" from anywhere, a field included:
 * the command modifier means it is never text. Shift is allowed for layouts that type `/` with it
 * (`Shift+7`), but not on the Slash key itself, where Shift is {@link isFocusLaneSearchShortcut}.
 * Matched by the produced `/` only, never by key position, so a layout whose Slash key is `-` keeps
 * Ctrl+- as zoom out.
 */
export function isFocusHeaderSearchShortcut(event: ShortcutKey): boolean {
	if (event.defaultPrevented || event.repeat || event.altKey) return false;
	if (event.ctrlKey === event.metaKey) return false;
	if (event.shiftKey && event.code === "Slash") return false;
	return event.key === "/";
}

/**
 * Ctrl+Shift+/ or Cmd+Shift+/ (exactly one command modifier) — "focus the side lane's search", from
 * anywhere, a field included. Most layouts report the chord as `?`, which is how a layout with `?`
 * elsewhere (`Shift+ß`) reaches it; a browser that reports the unshifted `/` on the Slash key is
 * matched too. Never with Alt, never a held key.
 */
export function isFocusLaneSearchShortcut(event: ShortcutKey): boolean {
	if (event.defaultPrevented || event.repeat || event.altKey || !event.shiftKey) return false;
	if (event.ctrlKey === event.metaKey) return false;
	return event.key === "?" || (event.key === "/" && event.code === "Slash");
}

/**
 * ⌘F on Apple platforms and Ctrl+F elsewhere, never both, never with Shift or Alt — "find in this
 * conversation". Ctrl+F stays the caret's step forward in macOS fields. A held key still matches, so
 * holding the chord never falls through to the browser's find. Matched by position on a non-Latin
 * layout.
 */
export function isFindInThreadShortcut(event: ShortcutKey, apple: boolean): boolean {
	if (event.defaultPrevented || event.shiftKey || event.altKey) return false;
	const modifier = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	if (!modifier) return false;
	const key = event.key.toLowerCase();
	return key === "f" || (!/^[a-z]$/.test(key) && event.code === "KeyF");
}

/** The hint for {@link isFocusLaneSearchShortcut}: `⇧⌘/` on an Apple device, `Ctrl ⇧ /` elsewhere. */
export function laneSearchShortcutLabel(apple: boolean): string {
	return apple ? "⇧⌘/" : "Ctrl ⇧ /";
}

/** The hint for {@link isFindInThreadShortcut}, as the composer spells its keys: `⌘F` or `Ctrl+F`. */
export function findInThreadShortcutLabel(apple: boolean): string {
	return apple ? "⌘F" : "Ctrl+F";
}

/**
 * The hint for {@link isFocusHeaderSearchShortcut}, as the search pills show it: `⌘ /` on an Apple
 * device, `Ctrl /` elsewhere. Read from the user agent once hydrated; the server renders `Ctrl /`.
 */
export function headerSearchShortcutLabel(userAgent: string): string {
	return isAppleDevice(userAgent) ? "⌘ /" : "Ctrl /";
}

/** Whether a user agent or `navigator.platform` names an Apple device, where a shortcut takes ⌘. */
export function isAppleDevice(platformOrUserAgent: string): boolean {
	return /Mac|iPhone|iPad|iPod/.test(platformOrUserAgent);
}

// #region The feedback sequence — "g" then "f" (Decision #272)
/** How long after `g` an `f` still completes the sequence. */
export const FEEDBACK_SEQUENCE_WINDOW_MS = 1000;

/** The previous keystroke of a two-key sequence, as the caller remembered it. */
export interface ShortcutPress {
	/** The letter it produced, lowercased (by key position on a non-Latin layout). */
	key: string;
	/** When it was pressed (`performance.now()` or `Date.now()` — the same clock as `now`). */
	at: number;
	/**
	 * Whether any handler took that keystroke — read from the event AFTER it finished dispatching
	 * (`event.defaultPrevented` persists), so a key a chat composer typed into its field never arms
	 * the sequence.
	 */
	taken: boolean;
}

/**
 * The letter a bare keystroke produces — no Ctrl, Cmd, Alt or Shift, not held, not already handled —
 * lowercased, matched by key position (`KeyG`) on a non-Latin layout; `null` for anything else. The
 * caller must still skip {@link isEditableTarget} targets: a letter typed into a field is text.
 */
export function bareLetterOf(event: ShortcutKey): string | null {
	if (event.defaultPrevented || event.repeat) return null;
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
	if (/^[a-z]$/.test(event.key)) return event.key;
	const position = /^Key([A-Z])$/.exec(event.code);
	return position && !/^[a-zA-Z]$/.test(event.key) ? position[1].toLowerCase() : null;
}

/**
 * `g` then `f` within {@link FEEDBACK_SEQUENCE_WINDOW_MS} — open the feedback board's drawer from
 * anywhere. True on the `f` that completes the sequence; the caller remembers each bare letter as the
 * `previous` press (a non-letter keystroke resets it). Both keys are bare, so the sequence cannot
 * collide with `/`, Ctrl/Cmd+/, Ctrl/Cmd+B or the reserved Cmd+K, and a `g` that another handler
 * took never arms it.
 */
export function isOpenFeedbackShortcut(
	event: ShortcutKey,
	previous: ShortcutPress | null,
	now: number,
): boolean {
	if (bareLetterOf(event) !== "f" || !previous) return false;
	if (previous.key !== "g" || previous.taken) return false;
	const elapsed = now - previous.at;
	return elapsed >= 0 && elapsed <= FEEDBACK_SEQUENCE_WINDOW_MS;
}
// #endregion
