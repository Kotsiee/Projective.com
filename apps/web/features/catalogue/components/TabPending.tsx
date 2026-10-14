import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import type { WorkspaceTab } from "../types/catalogue-types.ts";
import { setWorkspaceUrl } from "../core/workspace-store.ts";
import { TAB_LABELS } from "../core/workspace-model.ts";

const COPY: Readonly<Record<Exclude<WorkspaceTab, "edit">, string>> = {
	preview:
		"The buyer preview isn't available yet. The live card beside Edit shows how this listing reads in search.",
	analytics: "This listing's analytics aren't available here yet.",
	clients: "This listing's clients aren't listed here yet.",
};

/**
 * TabPending — what a workspace tab shows before its canvas exists: what is missing, and the way
 * back to Edit. Plain text on the canvas, never a boxed empty state.
 */
export function TabPending(props: { tab: Exclude<WorkspaceTab, "edit"> }): JSX.Element {
	return (
		<div class="cat-ws__pending">
			<h2 class="cat-ws__pending-title">{TAB_LABELS[props.tab]}</h2>
			<p class="cat-ws__pending-text">{COPY[props.tab]}</p>
			<Button
				label="Back to Edit"
				severity="neutral"
				variant="outlined"
				size="sm"
				onClick={() => setWorkspaceUrl({ tab: "edit" }, "push")}
			/>
		</div>
	);
}
