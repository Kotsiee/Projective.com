import { type Signal, useSignal } from "@preact/signals";
import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { dragVerdict } from "../core/calendar-import.ts";

/** What a file held over the grid looks like: one calendar file, something else, or no file drag. */
export type CalendarDropState = "ok" | "wrong" | null;

/** Options for {@link useCalendarDrop}. */
export interface CalendarDropOptions {
	/** A file was dropped that may be a calendar: check, read and import it. */
	onFile: (file: File) => void;
	/** Something that is not one calendar file was dropped. */
	onWrong: () => void;
	/** Off where the surface cannot create entries. */
	enabled: boolean;
}

/**
 * useCalendarDrop — make the calendar body a drop target for a calendar FILE (Decision #442).
 *
 * Native drag events on the surface element, and only for drags that carry files: a lane row's drag
 * is the pointer sensor's (`@projective/ui/dnd`) and a dragged link or text is not this zone's, so
 * both pass through untouched. Enter and leave fire for every child the pointer crosses, so a depth
 * count decides when the drag has really left. A file the browser would otherwise open in the tab is
 * always caught on a drop here, whatever it is, and a wrong one is said rather than ignored.
 */
export function useCalendarDrop(
	surface: RefObject<HTMLElement>,
	opts: CalendarDropOptions,
): Signal<CalendarDropState> {
	const state = useSignal<CalendarDropState>(null);
	const optsRef = useRef(opts);
	optsRef.current = opts;

	useEffect(() => {
		const el = surface.current;
		if (!el || !opts.enabled) return;
		let depth = 0;
		const verdict = (e: DragEvent) =>
			dragVerdict(
				Array.from(e.dataTransfer?.items ?? []).map((i) => ({ kind: i.kind, type: i.type })),
			);
		const enter = (e: DragEvent) => {
			const v = verdict(e);
			if (v === "none") return;
			e.preventDefault();
			depth++;
			state.value = v;
		};
		const over = (e: DragEvent) => {
			const v = verdict(e);
			if (v === "none") return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = v === "ok" ? "copy" : "none";
			if (state.peek() !== v) state.value = v;
		};
		const leave = (e: DragEvent) => {
			if (verdict(e) === "none") return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) state.value = null;
		};
		const drop = (e: DragEvent) => {
			const v = verdict(e);
			if (v === "none") return;
			e.preventDefault();
			depth = 0;
			state.value = null;
			const files = e.dataTransfer?.files;
			if (v === "ok" && files?.length === 1) optsRef.current.onFile(files[0]);
			else optsRef.current.onWrong();
		};
		el.addEventListener("dragenter", enter);
		el.addEventListener("dragover", over);
		el.addEventListener("dragleave", leave);
		el.addEventListener("drop", drop);
		return () => {
			el.removeEventListener("dragenter", enter);
			el.removeEventListener("dragover", over);
			el.removeEventListener("dragleave", leave);
			el.removeEventListener("drop", drop);
			state.value = null;
		};
	}, [surface, opts.enabled]);

	return state;
}
