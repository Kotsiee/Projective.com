import type { JSX } from "preact";

/** Props for {@link LegalDraftNotice}. */
export interface LegalDraftNoticeProps {
	/** The title's id, which names the note (unique on the page). */
	id?: string;
	/** `document` on a document page; `library` on the hub, where every document is a draft. */
	scope?: "document" | "library";
}

/**
 * LegalDraftNotice — the visible "Draft — pending legal review" disclosure every unreviewed legal
 * document carries (owner ruling (e), Decision #270): a required disclosure, which is the one kind
 * of non-interactive content §B.11.3 allows a container. A `role="note"` named by its title, inside
 * the document, so it prints with it.
 */
export function LegalDraftNotice(
	{ id = "lgl-draft-title", scope = "document" }: LegalDraftNoticeProps,
): JSX.Element {
	return (
		<div class="lgl-draft" role="note" aria-labelledby={id}>
			<p class="lgl-draft__title" id={id}>Draft — pending legal review</p>
			<p class="lgl-draft__text">
				{scope === "library"
					? "These documents describe how Projective works today and have not yet been reviewed by a lawyer. Their wording may change before they are."
					: "This text describes how Projective works today and has not yet been reviewed by a lawyer. Its wording may change before it is."}
			</p>
		</div>
	);
}
