import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { motionReduced } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import type { EditAnchor } from "../../core/owner-edit.ts";

/**
 * EditSection — one collapsible band of the owner's editor, on a native `<details>` so it opens and
 * closes with no script and is announced as the disclosure it is. The summary carries the section
 * name, a one-line description of what it controls and — when the section has unsaved edits or a
 * refused field — a small status word, so a collapsed section still says it needs attention.
 *
 * Its `id` is its anchor, the address the owner's Preview links to (`/[handle]/edit#about`, Decision
 * #408): when the address names the section, on arrival or on a later hash change, it opens and is
 * scrolled to the top of the view (smoothly only on a hash change, and never under reduced motion).
 *
 * Unboxed (§B.4): sections are separated by a single hairline and whitespace, never a card.
 */
export interface EditSectionProps {
	/** The section's anchor — the target of the Preview's edit links (`core/owner-edit.ts`). */
	id: EditAnchor;
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
	const ref = useRef<HTMLDetailsElement>(null);

	useEffect(() => {
		const reveal = (behavior: ScrollBehavior) => {
			const el = ref.current;
			if (!el || globalThis.location.hash !== `#${id}`) return;
			el.open = true;
			el.scrollIntoView({ block: "start", behavior: motionReduced() ? "auto" : behavior });
		};
		const arrive = () => requestAnimationFrame(() => reveal("auto"));
		const onHash = () => reveal("smooth");
		if (document.readyState === "complete") arrive();
		else globalThis.addEventListener("load", arrive, { once: true });
		globalThis.addEventListener("hashchange", onHash);
		return () => {
			globalThis.removeEventListener("load", arrive);
			globalThis.removeEventListener("hashchange", onHash);
		};
	}, [id]);

	return (
		<details ref={ref} class="pf-edit__section" id={id} open={open} data-state={state}>
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
