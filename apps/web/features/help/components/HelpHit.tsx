import type { JSX } from "preact";
import type { HelpCentreHighlight, HelpCentreSearchResult } from "@projective/types/editorial";
import { highlightSegments } from "../core/highlight.ts";

/** Text with its matched runs wrapped in `<mark>`. */
export function Highlighted(
	{ text, runs }: { text: string; runs: readonly HelpCentreHighlight[] },
): JSX.Element {
	return (
		<>
			{highlightSegments(text, runs).map((segment, i) =>
				segment.mark ? <mark key={i}>{segment.text}</mark> : segment.text
			)}
		</>
	);
}

/** Props for {@link HelpHit}. */
export interface HelpHitProps {
	result: HelpCentreSearchResult;
	/** The option's id, when it is an option of the overlay's listbox. */
	id?: string;
	/** Whether it is the overlay's active option. */
	active?: boolean;
	/** `option` inside the overlay's listbox; a plain link in the server-rendered fallback list. */
	role?: "option";
	onPointerMove?: () => void;
	onClick?: () => void;
}

/**
 * HelpHit — one search hit: the article's title and a snippet, matched words marked. The same markup
 * serves the server-rendered results (a link in a list) and the overlay (an option in a listbox), so
 * a hit reads the same with or without JavaScript.
 */
export function HelpHit(props: HelpHitProps): JSX.Element {
	const { result } = props;
	return (
		<a
			id={props.id}
			class="hc-hit"
			href={result.href}
			role={props.role}
			aria-selected={props.role ? props.active === true : undefined}
			tabIndex={props.role ? -1 : undefined}
			onPointerMove={props.onPointerMove}
			onClick={props.onClick}
		>
			<span class="hc-hit__title">
				<Highlighted text={result.title} runs={result.highlights.title} />
			</span>
			<span class="hc-hit__snippet">
				<Highlighted text={result.snippet} runs={result.highlights.snippet} />
			</span>
		</a>
	);
}
