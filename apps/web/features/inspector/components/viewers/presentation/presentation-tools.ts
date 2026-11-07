import { type Signal, signal } from "@preact/signals";
import type { StageFact } from "../../../core/inspector-shell.ts";
import type { Deck } from "../../../core/pptx-model.ts";

/** State of the slide canvas, shared by its stage, chips and panel. */
export interface PresentationTools {
	readonly deck: Signal<Deck | null>;
	/** The slide on show, from 0. */
	readonly slide: Signal<number>;
	/** The slide's text, for assistive technology. */
	readonly text: Signal<readonly string[]>;
}

/** Fresh tools; a deck arrives once the stage has opened the file. */
export function createPresentationTools(): PresentationTools {
	return {
		deck: signal<Deck | null>(null),
		slide: signal(0),
		text: signal<readonly string[]>([]),
	};
}

/** Go to a slide, staying inside the deck. */
export function goToSlide(tools: PresentationTools, index: number): void {
	const count = tools.deck.peek()?.slideCount ?? 0;
	if (count === 0) return;
	tools.slide.value = Math.max(0, Math.min(count - 1, index));
}

function ratioLabel(width: number, height: number): string {
	const ratio = width / height;
	if (Math.abs(ratio - 16 / 9) < 0.02) return "16:9";
	if (Math.abs(ratio - 4 / 3) < 0.02) return "4:3";
	if (Math.abs(ratio - 16 / 10) < 0.02) return "16:10";
	return `${Math.round(width / 72 * 100) / 100} × ${Math.round(height / 72 * 100) / 100} in`;
}

/** What the panel's Details says about a deck. */
export function deckFacts(deck: Deck): StageFact[] {
	return [
		{ label: "Slides", value: String(deck.slideCount) },
		{ label: "Slide size", value: ratioLabel(deck.width, deck.height) },
	];
}
