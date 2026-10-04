/// <reference lib="dom" />
import type { RefObject } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	loadedQuill,
	loadQuill,
	type QuillConstructor,
	type QuillInstance,
	warmQuill,
} from "@projective/ui/editor";
import { MESSAGE_MARKS, type MessageMark } from "@projective/types/projects";

/**
 * useComposerEditor — the chat composer's message field: a Quill editor that accepts exactly the four
 * marks a message can carry (Bold · Italic · Underline · Strikethrough) and nothing else, so typing,
 * the shortcuts and a paste can never introduce a format the feed cannot render.
 *
 * It replaces a plain `<textarea>` and keeps that field's contract: Enter sends, Shift+Enter breaks a
 * line, the field grows to a ceiling and then scrolls (in CSS — `.ql-editor`'s `max-block-size`), and
 * the plain text is always readable as a signal. What it adds is the selection the formatting bubble
 * hangs off, the marks active on it, and the editor's contents as ops for the outgoing Delta.
 *
 * Quill loads through the shared `@projective/ui/editor` loader — one memoised import and one
 * registered format set for every editor on the page — and is warmed during render so the fetch
 * overlaps hydration. Until it arrives the host is an empty box showing the placeholder; a click on
 * it is remembered and spent on focus at mount, and characters typed at the page in that window are
 * queued and inserted at mount rather than lost.
 *
 * The host element is Quill's once mounted: the caller renders it with a constant `class` and no
 * children, so a re-render of the composer never diffs a subtree Preact does not own.
 */

// #region Types
/** A collapsed caret is not a selection; the formatting bubble shows only for a real range. */
export interface EditorRange {
	index: number;
	length: number;
}

export interface UseComposerEditorOptions {
	placeholder: string;
	/** The field's accessible name. */
	label: string;
	/** Enter without Shift. */
	onSubmit: () => void;
	/** Escape in the field. Return `true` when something was dismissed (the key is then consumed). */
	onEscape: () => boolean;
	/** Paste, in the capture phase, before Quill sees it — call `preventDefault()` to take it over. */
	onPaste: (event: ClipboardEvent) => void;
}

export interface ComposerEditor {
	/** The element Quill mounts into. */
	hostRef: RefObject<HTMLDivElement>;
	/** Quill has mounted. */
	ready: Signal<boolean>;
	/** The field's plain text, without the editor's closing newline. */
	text: Signal<string>;
	/** The non-empty selection while the field has focus, else null. */
	range: Signal<EditorRange | null>;
	/** The marks active across the selection (or at the caret). */
	marks: Signal<Record<MessageMark, boolean>>;
	/** Bumped whenever the selection's on-screen position may have moved. */
	layoutTick: Signal<number>;
	focus(): void;
	/** Focus with the caret at the very end of the text. */
	focusEnd(): void;
	/** Append typed characters at the end and leave the caret after them. */
	appendTyped(chars: string): void;
	/** Toggle a mark across the selection (or for the next characters at the caret). */
	toggleMark(mark: MessageMark): void;
	/** The editor contents as raw Delta ops (normalise before sending). */
	ops(): unknown[];
	/** Empty the field. */
	clear(): void;
	/** The selection's box in viewport pixels, or null. */
	selectionRect(): { left: number; top: number; width: number; height: number } | null;
}
// #endregion

/** Every mark off — the resting state, and the state while Quill is not yet here. */
function noMarks(): Record<MessageMark, boolean> {
	return { bold: false, italic: false, underline: false, strike: false };
}

export function useComposerEditor(options: UseComposerEditorOptions): ComposerEditor {
	const hostRef = useRef<HTMLDivElement>(null);
	const quillRef = useRef<QuillInstance | null>(null);
	const ready = useSignal(false);
	const text = useSignal("");
	const range = useSignal<EditorRange | null>(null);
	const marks = useSignal<Record<MessageMark, boolean>>(noMarks());
	const layoutTick = useSignal(0);
	/** Characters typed at the page before Quill arrived, inserted on mount. */
	const pendingTyped = useRef("");
	/** A click or a focus request made before Quill arrived, honoured on mount. */
	const focusWhenReady = useRef(false);
	/** The latest callbacks, for the bindings Quill captured once at construction. */
	const live = useRef(options);
	live.current = options;

	warmQuill();

	// #region Readback
	function readMarks(quill: QuillInstance): void {
		const sel = quill.getSelection();
		if (!sel) {
			marks.value = noMarks();
			return;
		}
		const format = quill.getFormat(sel) as Record<string, unknown>;
		const next = noMarks();
		for (const mark of MESSAGE_MARKS) next[mark] = !!format[mark];
		marks.value = next;
	}

	function readSelection(quill: QuillInstance): void {
		const sel = quill.hasFocus() ? quill.getSelection() : null;
		range.value = sel && sel.length > 0 ? { index: sel.index, length: sel.length } : null;
		readMarks(quill);
		layoutTick.value++;
	}
	// #endregion

	// #region Mount
	useEffect(() => {
		let disposed = false;
		const host = hostRef.current;

		const onPasteCapture = (event: ClipboardEvent) => live.current.onPaste(event);
		// The bubble is fixed to the selection's on-screen box, which moves when the page or a
		// scroller around the field (the pop-out window) moves — not only when the selection does.
		const bump = () => {
			if (range.value) layoutTick.value++;
		};
		globalThis.addEventListener("resize", bump);
		globalThis.addEventListener("scroll", bump, true);
		host?.addEventListener("paste", onPasteCapture, true);
		const onEarlyPointer = () => {
			if (!quillRef.current) focusWhenReady.current = true;
		};
		host?.addEventListener("pointerdown", onEarlyPointer);

		const mount = (Quill: QuillConstructor) => {
			if (disposed || !host) return;
			const quill = new Quill(host, {
				placeholder: live.current.placeholder,
				formats: [...MESSAGE_MARKS],
				modules: {
					keyboard: {
						bindings: {
							// Added before Quill's own Enter handler, so it wins; Shift+Enter falls through to
							// the default line break.
							send: {
								key: "Enter",
								shiftKey: false,
								handler: () => {
									live.current.onSubmit();
									return false;
								},
							},
							// Quill binds Ctrl+B/I/U itself; strikethrough has no default, so it takes the
							// shortcut most chat apps already taught people.
							strike: {
								key: ["x", "X"],
								shortKey: true,
								shiftKey: true,
								handler(this: { quill: QuillInstance }, _range: unknown, ctx: {
									format: Record<string, unknown>;
								}) {
									this.quill.format("strike", !ctx.format.strike, "user");
									return false;
								},
							},
							escape: {
								key: "Escape",
								handler: () => !live.current.onEscape(),
							},
							// Tab leaves the field like it left the textarea, rather than typing a tab.
							tab: false,
						},
					},
				},
			});
			quillRef.current = quill;
			// The editable surface is Quill's own root, so that is what carries the field's name — a role on
			// the host would nest one textbox inside another.
			quill.root.setAttribute("role", "textbox");
			quill.root.setAttribute("aria-multiline", "true");
			quill.root.setAttribute("aria-label", live.current.label);

			quill.on("text-change", () => {
				text.value = quill.getText().replace(/\n$/, "");
				readSelection(quill);
			});
			quill.on("selection-change", () => readSelection(quill));
			quill.root.addEventListener("scroll", bump);

			host.setAttribute("data-ready", "true");
			ready.value = true;
			if (pendingTyped.current) {
				const queued = pendingTyped.current;
				pendingTyped.current = "";
				appendTyped(queued);
			} else if (focusWhenReady.current) {
				quill.focus();
			}
		};

		const loaded = loadedQuill();
		if (loaded) mount(loaded);
		else loadQuill().then(mount).catch(() => {});

		return () => {
			disposed = true;
			host?.removeEventListener("paste", onPasteCapture, true);
			host?.removeEventListener("pointerdown", onEarlyPointer);
			globalThis.removeEventListener("resize", bump);
			globalThis.removeEventListener("scroll", bump, true);
			quillRef.current?.off("text-change");
			quillRef.current?.off("selection-change");
			quillRef.current = null;
		};
	}, []);
	// #endregion

	// #region Commands
	function focus(): void {
		const quill = quillRef.current;
		if (quill) quill.focus();
		else focusWhenReady.current = true;
	}

	function focusEnd(): void {
		const quill = quillRef.current;
		if (!quill) {
			focusWhenReady.current = true;
			return;
		}
		quill.focus();
		quill.setSelection(quill.getLength() - 1, 0, "user");
	}

	function appendTyped(chars: string): void {
		const quill = quillRef.current;
		if (!quill) {
			pendingTyped.current += chars;
			focusWhenReady.current = true;
			return;
		}
		const end = quill.getLength() - 1;
		quill.focus();
		quill.insertText(end, chars, "user");
		quill.setSelection(end + chars.length, 0, "user");
	}

	function toggleMark(mark: MessageMark): void {
		const quill = quillRef.current;
		if (!quill) return;
		const sel = quill.getSelection(true);
		const on = !!(quill.getFormat(sel) as Record<string, unknown>)[mark];
		quill.format(mark, !on, "user");
		readSelection(quill);
	}

	function ops(): unknown[] {
		return quillRef.current ? [...quillRef.current.getContents().ops] : [];
	}

	function clear(): void {
		const quill = quillRef.current;
		if (!quill) return;
		quill.setText("", "user");
		quill.history.clear();
		text.value = "";
		range.value = null;
	}

	function selectionRect(): { left: number; top: number; width: number; height: number } | null {
		const quill = quillRef.current;
		const sel = range.value;
		if (!quill || !sel) return null;
		const bounds = quill.getBounds(sel.index, sel.length);
		if (!bounds) return null;
		const box = quill.container.getBoundingClientRect();
		const scroller = quill.root.getBoundingClientRect();
		// Clamp to the visible part of the field: a selection scrolled out of a tall draft anchors to
		// the field's edge instead of floating over the conversation.
		const top = Math.max(scroller.top, Math.min(box.top + bounds.top, scroller.bottom));
		return { left: box.left + bounds.left, top, width: bounds.width, height: bounds.height };
	}
	// #endregion

	return {
		hostRef,
		ready,
		text,
		range,
		marks,
		layoutTick,
		focus,
		focusEnd,
		appendTyped,
		toggleMark,
		ops,
		clear,
		selectionRect,
	};
}
