import type { JSX } from "preact";

/**
 * The hover-intent meta line (Decision #174): one line of the item's summary, opened on a RAIL card
 * after 350ms of hover or at once on keyboard focus. It stays in the DOM and the accessibility tree
 * everywhere; outside a rail the stylesheet never shows it.
 */
export function CardReveal({ text }: { text: string }): JSX.Element | null {
	const line = text.trim();
	if (!line) return null;
	return (
		<div class="ex-card__reveal">
			<div class="ex-card__revealclip">
				<p class="ex-card__revealtext">{line}</p>
			</div>
		</div>
	);
}

/**
 * The inline "New" fact. `separated` prefixes the middot that joins it to a preceding fact; the
 * separator is hidden from assistive tech.
 */
export function NewFact({ separated = true }: { separated?: boolean }): JSX.Element {
	return (
		<>
			{separated && <span class="ex-card__dot" aria-hidden="true">·</span>}
			<span class="ex-new">New</span>
		</>
	);
}
