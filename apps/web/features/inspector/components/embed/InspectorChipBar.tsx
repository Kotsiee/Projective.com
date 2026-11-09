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
import { CanvasToolbar } from "../CanvasToolbar.tsx";

/** Props for {@link InspectorChipBar}. */
export interface InspectorChipBarProps {
	host: InspectorHost;
}

/**
 * The canvas's footer toolbar for an embedding host, once the canvas is ready: its compact chips
 * where it has them (image and SVG zoom, rotate and thirds; PDF pages and zoom; slides), then
 * Fullscreen. It hides after a moment of pointer stillness over the host's stage box and returns on
 * the next movement; the theater carries its own copy, so nothing renders while it is open.
 * Absolutely positioned: render it as a child of `InspectorEmbedStage`, or inside another positioned
 * box over the stage.
 */
export function InspectorChipBar({ host }: InspectorChipBarProps): JSX.Element | null {
	const { shell } = host;
	if (shell.status.value !== "ready" || shell.fullscreen.value) return null;
	return (
		<InspectorActionsContext.Provider value={host.actions}>
			<CanvasToolbar shell={shell} viewer={host.viewer} />
		</InspectorActionsContext.Provider>
	);
}
