import type { ComponentChildren, JSX } from "preact";

/** Props for {@link ArticleMeta}. */
export interface ArticleMetaProps {
	/** The facts, already worded (`Projective Editorial`, `8 min read`, a `<time>`); falsy ones skipped. */
	facts: ComponentChildren[];
	/** Extra class(es). */
	class?: string;
}

/**
 * ArticleMeta — non-actionable facts as one Meta-register line (§B.11.2): list items separated by an
 * `aria-hidden` middot, so a screen reader hears a list rather than punctuation. Never chips. The
 * middot closes the fact before it rather than opening the next, so a line that wraps always starts
 * with a fact, never with a dangling separator.
 */
export function ArticleMeta({ facts, class: className }: ArticleMetaProps): JSX.Element {
	const shown = facts.filter((fact) =>
		fact !== null && fact !== undefined && fact !== false && fact !== ""
	);
	return (
		<ul class={className ? `artl-meta ${className}` : "artl-meta"} role="list">
			{shown.map((fact, i) => (
				<li key={i} class="artl-meta__item">
					{fact}
					{i < shown.length - 1 ? <span class="artl-meta__sep" aria-hidden="true">·</span> : null}
				</li>
			))}
		</ul>
	);
}
