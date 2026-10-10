import type { Signal } from "@preact/signals";
import type { JSX, Ref } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { useId } from "@projective/ui/hooks";
import type { InspectorShell } from "../core/inspector-shell.ts";
import { WORKSPACE_SHORTCUTS } from "../core/inspector-model.ts";
import type { MountedViewer, ViewerShortcut } from "./viewers/viewer.ts";
import { DetailsSection } from "./panel/DetailsSection.tsx";
import { LinksSection } from "./panel/LinksSection.tsx";
import { ShortcutsDisclosure } from "./panel/ShortcutsDisclosure.tsx";

/** Props for {@link InspectorPanel}. */
export interface InspectorPanelProps {
	id: string;
	shell: InspectorShell;
	viewer: MountedViewer;
	shortcutsOpen: Signal<boolean>;
	shortcutsRef: Ref<HTMLElement>;
}

/** The side panel: View (the canvas's controls), Details, Links. */
export function InspectorPanel(props: InspectorPanelProps): JSX.Element {
	const { id, shell, viewer, shortcutsOpen, shortcutsRef } = props;
	const viewTitle = useId(undefined, "ins-view");
	const detailsTitle = useId(undefined, "ins-details");
	const linksTitle = useId(undefined, "ins-links");
	const fullscreenSupported = shell.fullscreenSupported.value;
	const fullscreen = shell.fullscreen.value;
	const Controls = shell.status.value === "error" ? null : viewer.Controls;

	const shortcuts: ViewerShortcut[] = [
		...(Controls ? viewer.shortcuts : []),
		...WORKSPACE_SHORTCUTS.filter((s) => fullscreenSupported || s.keys[0] !== "F"),
	];

	return (
		<aside id={id} class="ins-panel" aria-label="File details">
			<section class="ins-panel__section" aria-labelledby={viewTitle}>
				<h2 id={viewTitle} class="ins-panel__title">View</h2>
				{Controls ? <Controls /> : null}
				{fullscreenSupported
					? (
						<div class="ins-panel__common">
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								icon={<Icon name={fullscreen ? "collapse" : "expand"} size="sm" />}
								label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
								aria-keyshortcuts="F"
								onClick={() => shell.toggleFullscreen()}
							/>
						</div>
					)
					: null}
				<ShortcutsDisclosure shortcuts={shortcuts} open={shortcutsOpen} summaryRef={shortcutsRef} />
			</section>
			<DetailsSection shell={shell} titleId={detailsTitle} />
			<LinksSection shell={shell} titleId={linksTitle} />
		</aside>
	);
}
