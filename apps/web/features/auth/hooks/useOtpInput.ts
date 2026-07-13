import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { JSX } from "preact";

/**
 * useOtpInput — the interaction model for a segmented one-time-code entry (the individual-digit
 * boxes on `/verify` and the reset step of `/forgot-password`). Handles single-digit-per-box entry,
 * auto-advance, backspace-to-previous, arrow navigation, and full-code paste distribution. The
 * boxes themselves are plain `<input>`s wired to the returned handlers, so the visual layer stays
 * token-only CSS (DESIGN_SYSTEM.md) with no widget dependency.
 */
export interface OtpInput {
	/** Number of digit boxes. */
	length: number;
	/** Per-box digit signal (`""` when empty). */
	digits: Signal<string[]>;
	/** The concatenated code, e.g. `"048213"`. */
	value: string;
	/** True once every box holds a digit. */
	complete: boolean;
	/** `ref` callback for box `index`. */
	setRef: (index: number) => (el: HTMLInputElement | null) => void;
	/** `onInput` handler factory for box `index`. */
	onInput: (index: number) => (e: JSX.TargetedEvent<HTMLInputElement>) => void;
	/** `onKeyDown` handler factory for box `index`. */
	onKeyDown: (index: number) => (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => void;
	/** `onPaste` handler — distributes a pasted code across the boxes. */
	onPaste: (e: JSX.TargetedClipboardEvent<HTMLInputElement>) => void;
	/** Clear all boxes and focus the first. */
	reset: () => void;
	/** Focus a specific box (clamped to range). */
	focus: (index: number) => void;
}

export function useOtpInput(length = 6): OtpInput {
	const digits = useSignal<string[]>(Array(length).fill(""));
	const refs = useRef<(HTMLInputElement | null)[]>([]);

	const value = digits.value.join("");
	const complete = value.length === length && /^\d+$/.test(value);

	const focus = (index: number) => {
		const i = Math.max(0, Math.min(length - 1, index));
		refs.current[i]?.focus();
		refs.current[i]?.select();
	};

	const setDigit = (index: number, digit: string) => {
		const next = [...digits.value];
		next[index] = digit;
		digits.value = next;
	};

	const setRef = (index: number) => (el: HTMLInputElement | null) => {
		refs.current[index] = el;
	};

	const onInput = (index: number) => (e: JSX.TargetedEvent<HTMLInputElement>) => {
		const digit = e.currentTarget.value.replace(/\D/g, "").slice(-1);
		setDigit(index, digit);
		e.currentTarget.value = digit;
		if (digit && index < length - 1) focus(index + 1);
	};

	const onKeyDown = (index: number) => (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Backspace") {
			if (digits.value[index]) {
				setDigit(index, "");
			} else if (index > 0) {
				focus(index - 1);
				setDigit(index - 1, "");
			}
		} else if (e.key === "ArrowLeft" && index > 0) {
			e.preventDefault();
			focus(index - 1);
		} else if (e.key === "ArrowRight" && index < length - 1) {
			e.preventDefault();
			focus(index + 1);
		}
	};

	const onPaste = (e: JSX.TargetedClipboardEvent<HTMLInputElement>) => {
		e.preventDefault();
		const text = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "").slice(0, length);
		if (!text) return;
		const next = Array(length).fill("");
		for (let i = 0; i < text.length; i++) next[i] = text[i];
		digits.value = next;
		focus(Math.min(text.length, length - 1));
	};

	const reset = () => {
		digits.value = Array(length).fill("");
		focus(0);
	};

	return { length, digits, value, complete, setRef, onInput, onKeyDown, onPaste, reset, focus };
}
