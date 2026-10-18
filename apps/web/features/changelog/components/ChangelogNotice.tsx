import type { ComponentChildren, JSX } from "preact";
import { DocumentHeader, DocumentLayout } from "@projective/ui/display/editorial";
import { CHANGELOG_PATH } from "../core/changelog-url.ts";

/** Why the changelog shows a notice instead of releases. */
export type ChangelogNoticeKind = "release-missing" | "page-missing" | "unavailable";

/** Props for {@link ChangelogNoticeView}. */
export interface ChangelogNoticeViewProps {
	kind: ChangelogNoticeKind;
	/** The address to try again (the unavailable notice). */
	retryHref?: string;
	/** The changelog's island carrier (the lightbox, which ships the stylesheet); omitted in tests. */
	carrier?: ComponentChildren;
}

const COPY: Readonly<Record<ChangelogNoticeKind, { title: string; summary: string }>> = {
	"release-missing": {
		title: "That release doesn't exist",
		summary:
			"There is no published release with that version. It may have been mistyped, or it is not out yet.",
	},
	"page-missing": {
		title: "That page of releases doesn't exist",
		summary: "The changelog has fewer pages than that. The newest releases are on the first page.",
	},
	unavailable: {
		title: "The changelog is unavailable",
		summary: "We couldn't load the releases just now. Please try again in a moment.",
	},
};

/**
 * ChangelogNoticeView — the changelog's not-found and unavailable states, inside the same reading
 * frame as the feed: one `<h1>`, one sentence, and the way out (the feed, or Try again). Rendered
 * with the status the route answers (404 or 503); the route also marks it `noindex`.
 */
export function ChangelogNoticeView(
	{ kind, retryHref, carrier }: ChangelogNoticeViewProps,
): JSX.Element {
	const copy = COPY[kind];
	return (
		<>
			<DocumentLayout
				class="chl-notice"
				header={<DocumentHeader eyebrow="Changelog" title={copy.title} summary={copy.summary} />}
			>
				<p class="chl-notice__actions">
					{kind === "unavailable" && retryHref
						? (
							<a
								class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md"
								href={retryHref}
							>
								<span class="ui-button__label">Try again</span>
							</a>
						)
						: (
							<a
								class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md"
								href={CHANGELOG_PATH}
							>
								<span class="ui-button__label">See every release</span>
							</a>
						)}
				</p>
			</DocumentLayout>
			{carrier}
		</>
	);
}
