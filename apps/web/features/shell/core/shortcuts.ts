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
