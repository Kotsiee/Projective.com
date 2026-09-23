import type { ComponentChildren, JSX } from "preact";
import { Icon } from "@projective/ui/icons";

/**
 * EditSection — one collapsible band of the owner's editor, on a native `<details>` so it opens and
 * closes with no script and is announced as the disclosure it is. The summary carries the section
 * name, a one-line description of what it controls and — when the section has unsaved edits or a
 * refused field — a small status word, so a collapsed section still says it needs attention.
 *
 * Unboxed (§B.4): sections are separated by a single hairline and whitespace, never a card.
 */
export interface EditSectionProps {
	id: string;
	title: string;
	description: string;
	/** Open on first paint (the default). */
	open?: boolean;
	/** `"edited"` · `"error"` — the summary's status word, or nothing. */
	state?: "edited" | "error";
	children: ComponentChildren;
}

export function EditSection(
	{ id, title, description, open = true, state, children }: EditSectionProps,
): JSX.Element {
	return (
		<details class="pf-edit__section" id={id} open={open} data-state={state}>
			<summary class="pf-edit__summary">
				<span class="pf-edit__heading">
					<span class="pf-edit__title">{title}</span>
					<span class="pf-edit__desc">{description}</span>
				</span>
				{state === "edited" && <span class="pf-edit__flag">Unsaved</span>}
				{state === "error" && <span class="pf-edit__flag pf-edit__flag--error">Check</span>}
				<Icon name="chevron-down" size="sm" class="pf-edit__caret" aria-hidden />
			</summary>
			<div class="pf-edit__body">{children}</div>
		</details>
	);
}
