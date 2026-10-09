import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { scrubDelta, useScrub } from "@projective/ui/fields";

/**
 * ScrubValue — a readout you can drag: horizontal travel changes the value along `NumberInput`'s
 * accelerated scrub curve (`scrubDelta`), under Pointer Lock where the browser grants it, and holding
 * Ctrl / Cmd swaps to the fine step, read live per sample. The keyboard path is the control beside
 * it (the slider or the ruler), so the readout itself stays out of the accessibility tree.
 */
export interface ScrubValueProps {
	value: number;
	step: number;
	fineStep: number;
	disabled?: boolean;
	format: (value: number) => string;
	/** Commit a value; answers the value as stored (clamped or wrapped). */
	onChange: (value: number) => number;
	/** Called with `true` while dragging, `false` on release. */
	onScrub?: (active: boolean) => void;
}

export function ScrubValue(props: ScrubValueProps): JSX.Element {
	const running = useRef(props.value);
	const scrub = useScrub({
		disabled: props.disabled,
		onStart: () => {
			running.current = props.value;
			props.onScrub?.(true);
		},
		onEnd: () => props.onScrub?.(false),
		onMove: (movementPx, elapsedMs, event) => {
			const fine = event.ctrlKey || event.metaKey;
			const delta = scrubDelta({ movementPx, elapsedMs, step: fine ? props.fineStep : props.step });
			if (delta === 0) return;
			running.current = props.onChange(running.current + delta);
		},
	});

	return (
		<span
			class="pf-media__value pf-media__value--scrub"
			aria-hidden="true"
			data-scrubbing={scrub.active.value ? "true" : undefined}
			data-disabled={props.disabled ? "true" : undefined}
			onPointerDown={scrub.handlers.onPointerDown}
		>
			{props.format(props.value)}
		</span>
	);
}
