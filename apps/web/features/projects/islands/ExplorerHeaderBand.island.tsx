import type { JSX } from "preact";
import "../styles/explorer-header.css";
import { ExplorerToolbar } from "../components/ExplorerToolbar.tsx";
import { explorerTitle } from "../core/explorer-state.ts";

/**
 * ExplorerHeaderBand — the middle-nav header band on a project's own Files and Submissions routes
 * (Decision #317). Those routes are project views, not channels, so no channel header claims the band;
 * it carries the folder in view's title and the explorer's toolbar instead of the body drawing that
 * toolbar above its grid. Where a channel or a conversation owns the band, the body keeps the toolbar
 * (`ExplorerToolbar placement="body"`), so the controls are always drawn exactly once.
 *
 * Dumb island: the title is the SSR node's until the body publishes the node it is showing, and every
 * control writes the shared `explorer-state` intent that the body — the single fetch owner — reads.
 */
export interface ExplorerHeaderBandProps {
	/** The node in view, as the server resolved it ("All files", "Project files", a stage). */
	title: string;
	noun: "files" | "submissions";
}

export default function ExplorerHeaderBand({ title, noun }: ExplorerHeaderBandProps): JSX.Element {
	return (
		<div class="fxh">
			<h1 class="fxh__title">{explorerTitle.value ?? title}</h1>
			<ExplorerToolbar noun={noun} placement="band" />
		</div>
	);
}
