import "../../styles/inspector.css";
import "../../styles/viewer-image.css";
import "../../styles/viewer-media.css";
import "../../styles/viewer-text.css";
import "../../styles/code-theme.css";
import "../../styles/viewer-pdf.css";
import "../../styles/inspector-print.css";
import "../../styles/viewer-model.css";
import "../../styles/viewer-document.css";
import type { ComponentChildren, JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import type { InspectorHost } from "../../hooks/use-inspector-host.ts";
import { InspectorActionsContext } from "../InspectorContext.ts";
import { InspectorLiveRegion } from "../InspectorLiveRegion.tsx";
import { InspectorStage } from "../InspectorStage.tsx";

/** Props for {@link InspectorEmbedStage}. */
export interface InspectorEmbedStageProps {
	host: InspectorHost;
	class?: string;
	/** Rendered over the canvas, e.g. `InspectorChipBar`; positioned against the stage box. */
	children?: ComponentChildren;
}

/**
 * The inspector's canvas for a host surface: the viewer's stage (loader, fallback and all) filling
 * the host's box, the workspace actions every canvas control reads, and the live region. The root
 * isolates its stacking so the canvas's own layers never rise above the host's chrome.
 */
export function InspectorEmbedStage(
	{ host, class: className, children }: InspectorEmbedStageProps,
): JSX.Element {
	const { shell, viewer, actions } = host;
	return (
		<InspectorActionsContext.Provider value={actions}>
			<div class={cx("ins-embed", className)} data-viewer={shell.asset.viewer}>
				<InspectorStage shell={shell} viewer={viewer} />
				{children}
				<InspectorLiveRegion shell={shell} />
			</div>
		</InspectorActionsContext.Provider>
	);
}
