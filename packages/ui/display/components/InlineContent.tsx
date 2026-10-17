import type { JSX } from "preact";
import {
	type InlineContent as InlineContentValue,
	type InlineRun,
	isExternalHref,
} from "@projective/types/content";

// #region Props
/** Props for {@link InlineContent}. */
export interface InlineContentProps {
	/** A plain string, or a sequence of inline runs. */
	content: InlineContentValue;
}
// #endregion

/** One run as an element (or bare text). Text is always a child, so Preact escapes it. */
function renderRun(run: InlineRun, key: number): JSX.Element | string {
	if (typeof run === "string") return run;
	switch (run.type) {
		case "text":
			return run.text;
		case "strong":
			return <strong key={key}>{run.text}</strong>;
		case "em":
			return <em key={key}>{run.text}</em>;
		case "code":
			return <code key={key} class="ui-prose__code">{run.text}</code>;
		case "link":
			return isExternalHref(run.href)
				? <a key={key} href={run.href} rel="noopener noreferrer">{run.text}</a>
				: <a key={key} href={run.href}>{run.text}</a>;
	}
}

/**
 * InlineContent — renders a paragraph's (or a cell's, an item's) inline runs as semantic phrasing
 * elements: `<strong>`, `<em>`, `<code>`, `<a>`. Every string reaches the DOM as a text child, so
 * the content model's guarantee holds end to end: nothing an author writes can become markup. Link
 * targets were validated by the schema; an external one gets `rel="noopener noreferrer"`. Zero-JS,
 * stylesheet-free (prose.css, via the editorial aggregate).
 */
export function InlineContent({ content }: InlineContentProps): JSX.Element {
	if (typeof content === "string") return <>{content}</>;
	return <>{content.map(renderRun)}</>;
}
