import type { JSX } from "preact";

/**
 * ChannelTabBody — the scaffold body for a channel view tab (Chat · Files · Members · Submissions ·
 * Calendar · Tasks) while each real surface is built out. Server-rendered (zero client JS); it names
 * the active view and, when `filler` is set, draws skeleton rows so the pinned {@link ChannelHeader}
 * can be seen holding position as the body scrolls. Replaced per-tab as the views land.
 */
export interface ChannelTabBodyProps {
	title: string;
	note: string;
	/** Skeleton rows to render below the note (demonstrates the header pin under scroll). */
	filler?: number;
}

export function ChannelTabBody({ title, note, filler = 0 }: ChannelTabBodyProps): JSX.Element {
	return (
		<section class="chan-body" aria-label={title}>
			<h2 class="chan-body__title">{title}</h2>
			<p class="chan-body__note">{note}</p>
			{filler > 0 && (
				<div class="chan-body__skeleton" aria-hidden="true">
					{Array.from({ length: filler }, (_, i) => <div key={i} class="chan-body__line" />)}
				</div>
			)}
		</section>
	);
}
