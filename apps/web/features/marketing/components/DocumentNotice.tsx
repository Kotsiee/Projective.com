import type { ComponentChildren, JSX } from "preact";
import { DocumentHeader, DocumentLayout } from "@projective/ui/display/editorial";

/** One way out of a notice — a link styled as a button. */
export interface DocumentNoticeAction {
	href: string;
	label: string;
}

/** Props for {@link DocumentNotice}. */
export interface DocumentNoticeProps {
	/**
	 * The surface's BEM block (`artl-notice`, `lgl-notice`): the frame carries it and the action row
	 * is `<block>__actions`, laid out by the surface's own stylesheet.
	 */
	block: string;
	/** The surface the notice belongs to ("Articles", "Legal"). */
	eyebrow: string;
	/** The page's one `<h1>`. */
	title: string;
	/** One sentence: what happened and why. */
	summary: string;
	/** The ways out, most useful first; the first is outlined, the rest are text links. */
	actions: readonly DocumentNoticeAction[];
	/** The surface's island, which carries its stylesheet and the Button sheet; omitted in tests. */
	carrier?: ComponentChildren;
}

/**
 * DocumentNotice — an editorial surface's not-found state inside the same reading frame (and so the
 * same public shell) as its documents: the eyebrow, one `<h1>`, one sentence and the way out. The
 * changelog's `ChangelogNoticeView` is the model; the articles reader and the legal documents use
 * this one. The route answers it with its 404 status and marks the page `noindex`.
 *
 * The frame's sheet (`editorial.css`) is global; the action row and the buttons ride the surface's
 * `carrier` island, because a server component's own CSS import reaches no page. Stylesheet-free, so
 * it renders under `deno test`.
 */
export function DocumentNotice(props: DocumentNoticeProps): JSX.Element {
	const { block, eyebrow, title, summary, actions, carrier } = props;
	return (
		<>
			<DocumentLayout
				class={block}
				header={<DocumentHeader eyebrow={eyebrow} title={title} summary={summary} />}
			>
				<p class={`${block}__actions`}>
					{actions.map((action, index) => (
						<a
							key={action.href}
							class={`ui-button ui-button--neutral ${
								index === 0 ? "ui-button--outlined" : "ui-button--text"
							} ui-button--size-md`}
							href={action.href}
						>
							<span class="ui-button__label">{action.label}</span>
						</a>
					))}
				</p>
			</DocumentLayout>
			{carrier}
		</>
	);
}
