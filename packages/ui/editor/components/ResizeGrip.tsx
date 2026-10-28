import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/resize.css";
import type { ResizeAxis } from "../core/resize.ts";
import type { EditorResize } from "../hooks/useEditorResize.ts";

/** An in-frame grip, named logically like DraggablePopover's: the host's end edges and their corner. */
export type FrameGrip = "block-end" | "inline-end" | "end-end";

const GRIP_AXIS: Record<FrameGrip, ResizeAxis> = {
	"block-end": "block",
	"inline-end": "inline",
	"end-end": "both",
};

const GRIP_ORIENTATION: Record<FrameGrip, "horizontal" | "vertical" | undefined> = {
	"block-end": "horizontal",
	"inline-end": "vertical",
	"end-end": undefined,
};

export interface ResizeGripProps {
	grip: FrameGrip;
	/** The host's `useEditorResize` result — the grip only routes its pointer and keys to it. */
	resize: EditorResize;
	/** Accessible name, e.g. "Resize editor height". */
	label: string;
}

/**
 * ResizeGrip — one resize grip for a positioned, rounded host: a transparent hit strip on the edge it
 * moves, followed by the `--primary` frame cue it lights on hover, keyboard focus and for the whole
 * drag (DraggablePopover's look, `styles/resize.css`). A focusable `role="separator"` operable by
 * arrow key, because a native `resize` grip is mouse-only.
 *
 * Renders nothing until hydrated: before then it could not resize anything, and the host keeps its
 * native grip (it is switched off only once a `.ui-resize-grip` exists). The mount flag re-renders
 * this component alone, never a host that owns a third-party subtree.
 */
export function ResizeGrip({ grip, resize, label }: ResizeGripProps): JSX.Element | null {
	const mounted = useSignal(false);
	useEffect(() => {
		mounted.value = true;
	}, []);
	if (!mounted.value) return null;

	const axis = GRIP_AXIS[grip];
	// Spans, not divs: a frame may sit inside a `<label>`, which admits phrasing content only.
	return (
		<>
			<span
				class={`ui-resize-grip ui-resize-grip--${grip}`}
				role="separator"
				aria-orientation={GRIP_ORIENTATION[grip]}
				aria-label={label}
				tabIndex={0}
				onPointerDown={(e) => resize.start(axis, e)}
				onKeyDown={(e) => resize.onKeyDown(axis, e)}
			/>
			<span class="ui-resize-cue" data-grip={grip} aria-hidden="true" />
		</>
	);
}
