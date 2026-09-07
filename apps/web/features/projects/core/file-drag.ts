import { signal } from "@preact/signals";

/**
 * file-drag — whether the reader is currently dragging FILES over this page, as one shared signal.
 *
 * The setup surface has two places a file can be dropped — the reference attachments, and the custom
 * NDA inside Advanced options — and neither is where somebody with a file in hand is looking. So the
 * zones announce themselves the moment a drag enters the WINDOW rather than waiting to be hovered:
 * the reader finds out where they may drop by looking, instead of by hunting with a held pointer.
 *
 * ## Why a window-level watcher rather than per-zone `dragenter`
 *
 * A zone can only light up once the pointer is already over it, which answers the question one move
 * too late and cannot show a SECOND zone at all. Announcing from the window is what makes "you have
 * a choice of two destinations" expressible.
 *
 * ## The counter, and why it is not enough on its own
 *
 * `dragleave` fires every time the pointer crosses into a CHILD element, so a naive
 * enter-sets-true / leave-sets-false pair flickers off over every nested node on the page. The
 * standard remedy is a depth counter, and it is used here — but it is not sufficient by itself: a
 * drag that leaves the window through the address bar, ends on a `drop` handled by another
 * document, or is cancelled with Escape can skip its final `dragleave` entirely, and the counter is
 * then stuck above zero with every zone lit and no drag in progress. So `dragover` (which fires
 * continuously while a drag is live) refreshes a watchdog, and the watchdog is what actually
 * guarantees the state comes back down.
 */

// #region State
/** `true` while a file drag is somewhere over this document. */
export const fileDragActive = signal<boolean>(false);
// #endregion

// #region Detection
/**
 * How long after the last `dragover` a drag is considered finished.
 *
 * `dragover` repeats at roughly the pointer's own rate while a drag is live — tens of milliseconds —
 * so this is an order of magnitude above the real gap and still short enough that a stuck highlight
 * clears before anybody reaches for it.
 */
const DRAG_IDLE_MS = 240;

/**
 * Whether this drag is carrying files.
 *
 * Selecting text and dragging it, or dragging a link, are drags too — and lighting a file drop zone
 * for them would promise something the drop cannot deliver. `types` is the one part of `dataTransfer`
 * readable during a drag (the items themselves are protected until drop), and `"Files"` is its
 * standard marker.
 */
function carriesFiles(event: DragEvent): boolean {
	const types = event.dataTransfer?.types;
	if (!types) return false;
	// A `DOMStringList` in older engines, an array in current ones. `includes` exists on both as of
	// the DOM spec's change, but `Array.from` is the form that is correct for either.
	return Array.from(types as ArrayLike<string>).includes("Files");
}

/**
 * Watch the window for file drags and keep {@link fileDragActive} in step. Returns its unsubscribe.
 *
 * Bound with `capture: true` so a zone that stops propagation for its own purposes cannot blind the
 * window-level state — the capture phase runs from the root down, so this sees the event first
 * regardless of what any handler beneath it does with it.
 *
 * Nothing here calls `preventDefault`. Doing so at the window would make the WHOLE page a drop
 * target, so a file released over the form's prose would be swallowed instead of being handed back
 * to the browser; the zones prevent it for themselves, over the area where a drop actually means
 * something.
 */
export function watchFileDrag(): () => void {
	if (typeof globalThis.addEventListener !== "function") return () => {};

	let depth = 0;
	let idle: ReturnType<typeof setTimeout> | undefined;

	const stop = () => {
		depth = 0;
		clearTimeout(idle);
		idle = undefined;
		fileDragActive.value = false;
	};

	const onEnter = (event: DragEvent) => {
		if (!carriesFiles(event)) return;
		depth += 1;
		fileDragActive.value = true;
	};

	const onOver = (event: DragEvent) => {
		if (!carriesFiles(event)) return;
		fileDragActive.value = true;
		clearTimeout(idle);
		idle = setTimeout(stop, DRAG_IDLE_MS);
	};

	const onLeave = (event: DragEvent) => {
		if (!carriesFiles(event)) return;
		depth = Math.max(0, depth - 1);
		if (depth === 0) fileDragActive.value = false;
	};

	globalThis.addEventListener("dragenter", onEnter, true);
	globalThis.addEventListener("dragover", onOver, true);
	globalThis.addEventListener("dragleave", onLeave, true);
	// A drop anywhere ends the drag — including one the zones did not handle, which is exactly the
	// case the counter would otherwise leave lit.
	globalThis.addEventListener("drop", stop, true);
	globalThis.addEventListener("dragend", stop, true);
	// A drag interrupted by a tab switch or a window blur never reports its own end.
	globalThis.addEventListener("blur", stop);

	return () => {
		clearTimeout(idle);
		globalThis.removeEventListener("dragenter", onEnter, true);
		globalThis.removeEventListener("dragover", onOver, true);
		globalThis.removeEventListener("dragleave", onLeave, true);
		globalThis.removeEventListener("drop", stop, true);
		globalThis.removeEventListener("dragend", stop, true);
		globalThis.removeEventListener("blur", stop);
		fileDragActive.value = false;
	};
}
// #endregion

// #region Reading a drop
/**
 * The files a drop is carrying, ignoring directories and anything that is not a file.
 *
 * `dataTransfer.files` rather than walking `items` as entries: a directory dropped into a reference
 * pack has no meaning here (an attachment is one asset), and the entries API is the wrong tool for
 * a list that is deliberately flat.
 */
export function filesFrom(event: DragEvent): File[] {
	const list = event.dataTransfer?.files;
	if (!list || list.length === 0) return [];
	return Array.from(list);
}
// #endregion
