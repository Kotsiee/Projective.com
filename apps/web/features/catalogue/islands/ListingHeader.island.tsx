import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/catalogue.css";
import { Icon } from "@projective/ui/icons";
import { statusMeta } from "../core/catalogue-model.ts";
import { editorSaveState, editorStatus, editorTitle } from "../core/catalogue-state.ts";
import type { ListingStatus } from "../types/catalogue-types.ts";

/**
 * ListingHeader — the manage page's middle-nav HEADER band: back · live title · status chip · autosave
 * state. All four were previously in `.cat-editor__bar`, a `position: static` strip at the top of a
 * 1264px scrolling body — so on a form of any length the seller lost their status, their save
 * indicator and their way back at the same moment. An autosave signal that scrolls out of view is not
 * a signal, which is the whole reason this band exists.
 *
 * Dumb: it renders the signals the editor body publishes. The SSR props seed the first paint so the
 * band is correct before hydration.
 */

export interface ListingHeaderProps {
	/** The listing's SSR title + status, so the band paints correctly in the first byte. */
	title: string;
	status: ListingStatus;
}

const SAVE_COPY: Record<"saved" | "saving" | "unsaved", string> = {
	saved: "All changes saved",
	saving: "Saving…",
	unsaved: "Unsaved changes",
};

export default function ListingHeader(props: ListingHeaderProps): JSX.Element {
	useEffect(() => {
		editorTitle.value = props.title;
		editorStatus.value = props.status;
	}, []);

	// Fall back to the SSR props until the body island has published (one frame), so no flash of empty.
	const title = editorTitle.value || props.title;
	const status = editorStatus.value ?? props.status;
	const meta = statusMeta(status);
	const save = editorSaveState.value;

	return (
		<div class="cat-lhdr">
			<a class="cat-lhdr__back" href="/catalogue">
				<Icon name="chevron-left" />
				<span>Catalogue</span>
			</a>

			<h1 class="cat-lhdr__title" title={title}>{title || "Untitled listing"}</h1>

			<span class="cat-chip" data-tone={meta.tone}>{meta.label}</span>

			{
				/*
				 * The save state carries its meaning three ways, never colour alone: a word, a tone, and a
				 * mark whose shape differs per state (a spinner ring while saving, a tick when settled, a
				 * dot while dirty).
				 */
			}
			<span class="cat-lhdr__save" data-state={save} role="status">
				<span class="cat-lhdr__savemark" aria-hidden="true" data-state={save} />
				{SAVE_COPY[save]}
			</span>
		</div>
	);
}
