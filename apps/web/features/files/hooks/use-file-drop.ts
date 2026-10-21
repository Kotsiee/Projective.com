import type { JSX } from "preact";
import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";

/** The drop target's state and the handlers to spread onto its root element. */
export interface FileDropTarget {
	/** Files from the operating system are being dragged over the target. */
	active: ReadonlySignal<boolean>;
	handlers: {
		onDragEnter: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
		onDragOver: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
		onDragLeave: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
		onDrop: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
	};
}

function carriesFiles(event: DragEvent): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Accept files dropped from the operating system onto one element.
 *
 * Only a drag that carries files lights the target, so selecting text or an in-page pointer drag
 * (the hub's move-to-folder) never does. A depth counter absorbs the enter/leave pair every child
 * element fires, which is what makes a highlight flicker. While `accepts()` is false a file drag is
 * still claimed — with the `none` drop effect — so the browser shows "not allowed" instead of
 * navigating away to the dropped file and discarding the page.
 */
export function useFileDrop(
	accepts: () => boolean,
	onFiles: (files: File[]) => void,
): FileDropTarget {
	const active = useSignal(false);
	const depth = useRef(0);

	function reset(): void {
		depth.current = 0;
		active.value = false;
	}

	function claim(event: JSX.TargetedDragEvent<HTMLElement>): boolean {
		if (!carriesFiles(event)) return false;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = accepts() ? "copy" : "none";
		return true;
	}

	return {
		active,
		handlers: {
			onDragEnter(event) {
				if (!claim(event)) return;
				depth.current += 1;
				active.value = accepts();
			},
			onDragOver(event) {
				claim(event);
			},
			onDragLeave(event) {
				if (!carriesFiles(event)) return;
				depth.current = Math.max(0, depth.current - 1);
				if (depth.current === 0) active.value = false;
			},
			onDrop(event) {
				if (!claim(event)) return;
				reset();
				const files = Array.from(event.dataTransfer?.files ?? []);
				if (files.length > 0 && accepts()) onFiles(files);
			},
		},
	};
}
