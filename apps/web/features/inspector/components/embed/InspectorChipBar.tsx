import "../../styles/inspector.css";
import "../../styles/viewer-image.css";
import "../../styles/viewer-media.css";
import "../../styles/viewer-text.css";
import "../../styles/code-theme.css";
import "../../styles/viewer-pdf.css";
import "../../styles/inspector-print.css";
import "../../styles/viewer-model.css";
import "../../styles/viewer-document.css";
import type { JSX } from "preact";
import type { InspectorHost } from "../../hooks/use-inspector-host.ts";
import { InspectorActionsContext } from "../InspectorContext.ts";

/** Props for {@link InspectorChipBar}. */
export interface InspectorChipBarProps {
	host: InspectorHost;
}

/**
 * Compact chips floating at the bottom of the canvas, for canvases that have them: image and SVG
 * (zoom out, level, zoom in, fit, rotate, reset, rule of thirds) and PDF (page n / N, zoom). Nothing
 * for other canvases or until the canvas is ready. Absolutely positioned: render it as a child of
 * `InspectorEmbedStage`, or inside another positioned box over the stage.
 */
export function InspectorChipBar({ host }: InspectorChipBarProps): JSX.Element | null {
	const Chips = host.viewer.Chips;
	if (!Chips || host.shell.status.value !== "ready") return null;
	return (
		<InspectorActionsContext.Provider value={host.actions}>
			<Chips />
		</InspectorActionsContext.Provider>
	);
}
