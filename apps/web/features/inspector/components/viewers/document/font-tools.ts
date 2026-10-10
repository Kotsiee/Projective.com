import { type Signal, signal } from "@preact/signals";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import type { FontSpecimen } from "../../../core/font-specimen.ts";

/** The preset sample texts a viewer can start from. */
export type SamplePreset = "pangram" | "alphabet" | "numerals" | "paragraph";

/** Preset sample texts, in choice order. */
export const SAMPLE_TEXT: Readonly<Record<SamplePreset, string>> = {
	pangram: "The quick brown fox jumps over the lazy dog",
	alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz",
	numerals: "0123456789\n€ £ $ ¥ % ‰ + − × ÷ = ½ ¼ ¾",
	paragraph:
		"Typography is the craft of endowing human language with a durable visual form. Good type " +
		"stays out of the way: the reader notices the words, not the letters that carry them.",
};

/** Sample size bounds, in CSS pixels. */
export const SAMPLE_SIZE = Object.freeze({ min: 12, max: 200, initial: 64 });

const SIZE_LADDER = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 96, 120, 144, 176, 200];

/** The font canvas's state, shared by its stage and its panel controls. */
export interface FontTools {
	readonly sample: Signal<string>;
	readonly preset: Signal<SamplePreset>;
	readonly size: Signal<number>;
	/** The registered preview family once the font has loaded. */
	readonly family: Signal<string | null>;
	readonly specimen: Signal<FontSpecimen | null>;
	resize(direction: 1 | -1): void;
	resetSample(): void;
}

/** Create the font canvas state. Signals only, so it is safe during SSR. */
export function createFontTools(shell: InspectorShell): FontTools {
	const size = signal<number>(SAMPLE_SIZE.initial);
	const preset = signal<SamplePreset>("pangram");
	const sample = signal(SAMPLE_TEXT.pangram);
	return {
		sample,
		preset,
		size,
		family: signal<string | null>(null),
		specimen: signal<FontSpecimen | null>(null),
		resize(direction) {
			const current = size.peek();
			const next = direction > 0
				? SIZE_LADDER.find((s) => s > current) ?? SAMPLE_SIZE.max
				: [...SIZE_LADDER].reverse().find((s) => s < current) ?? SAMPLE_SIZE.min;
			size.value = next;
			shell.announce(`Sample size ${next} pixels`);
		},
		resetSample() {
			sample.value = SAMPLE_TEXT[preset.peek()];
			shell.announce("Sample text reset");
		},
	};
}
