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

/** Props for {@link InspectorEmbedControls}. */
export interface InspectorEmbedControlsProps {
	host: InspectorHost;
}

/**
 * The canvas's own controls (zoom, find, playback…) for a host's side panel; nothing when the
 * canvas has none or has failed.
 */
export function InspectorEmbedControls({ host }: InspectorEmbedControlsProps): JSX.Element | null {
	const Controls = host.shell.status.value === "error" ? null : host.viewer.Controls;
	if (!Controls) return null;
	return (
		<InspectorActionsContext.Provider value={host.actions}>
			<div class="ins-embed-controls">
				<Controls />
			</div>
		</InspectorActionsContext.Provider>
	);
}
