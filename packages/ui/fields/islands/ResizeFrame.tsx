import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { ResizeGrip } from "../../editor/components/ResizeGrip.tsx";
import { useEditorResize } from "../../editor/hooks/useEditorResize.ts";

export interface ResizeFrameProps {
	/** One native `<textarea>`, styled by the caller and left untouched here. */
	children: ComponentChildren;
	/** Accessible name of the grip. */
	label?: string;
	class?: string;
}

/**
 * ResizeFrame — the resize grip for a caller-styled native `<textarea>`. Wrap the textarea and its
 * browser grip (unstylable, mouse-only, one corner) gives way to a bottom-edge `ResizeGrip` with
 * DraggablePopover's `--primary` frame cue, keyboard resize included. The textarea keeps its own
 * class, box and `resize` declaration: the native grip is switched off only once the custom one has
 * mounted, so a frame that never hydrates still resizes. Use `Textarea` for a new field; this is for
 * a textarea a feature styles itself.
 */
export function ResizeFrame(
	{ children, label = "Resize text area height", class: className }: ResizeFrameProps,
): JSX.Element {
	const frameRef = useRef<HTMLSpanElement>(null);
	const surfaceRef = useRef<HTMLElement | null>(null);
	const drag = useEditorResize({ containerRef: frameRef, surfaceRef, horizontal: false });

	useEffect(() => {
		const frame = frameRef.current;
		const surface = frame?.querySelector("textarea") ?? null;
		surfaceRef.current = surface;
		// shortcut: the textarea's radius is copied once, so a live radius-scale change leaves the
		// cue's corners stale until remount; read it on each hover if that ever shows.
		if (frame && surface) {
			frame.style.setProperty("--resize-radius", getComputedStyle(surface).borderRadius);
		}
	}, []);

	return (
		<span ref={frameRef} class={cx("ui-resize-frame", className)}>
			{children}
			<ResizeGrip grip="block-end" resize={drag} label={label} />
		</span>
	);
}
