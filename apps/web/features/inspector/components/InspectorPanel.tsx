import type { Signal } from "@preact/signals";
import type { JSX, Ref } from "preact";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { useId } from "@projective/ui/hooks";
import { TabStrip } from "@projective/ui/navigation";
import type { InspectorShell } from "../core/inspector-shell.ts";
import { WORKSPACE_SHORTCUTS } from "../core/inspector-model.ts";
import {
	choosePanelTab,
	INSPECT_PANEL_TABS,
	panelTab,
	restorePanelTab,
	tabWithin,
} from "../core/panel-tab.ts";
import type { MountedViewer, ViewerShortcut } from "./viewers/viewer.ts";
import { AccessSection } from "./access/AccessSection.tsx";
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

/**
 * The side panel, three tabs: View (the canvas's controls, Fullscreen and the keyboard shortcuts),
 * Details (the facts and the links; Decision #400) and Access (who can open the file; Decision #402).
 * The tab is remembered for the next file, here and in the preview modal. Asking for the shortcuts
 * (`?`) shows the View tab, where they are listed.
 */
export function InspectorPanel(props: InspectorPanelProps): JSX.Element {
	const { id, shell, viewer, shortcutsOpen, shortcutsRef } = props;
	const detailsTitle = useId(undefined, "ins-details");
	const linksTitle = useId(undefined, "ins-links");
	const accessTitle = useId(undefined, "ins-access");
	const body = `${id}-body`;
	const fullscreen = shell.fullscreen.value;
	const Controls = shell.status.value === "error" ? null : viewer.Controls;

	useEffect(() => restorePanelTab(), []);

	const shortcuts: ViewerShortcut[] = [
		...(Controls ? viewer.shortcuts : []),
		...WORKSPACE_SHORTCUTS,
	];
	const tab = tabWithin(panelTab.value, INSPECT_PANEL_TABS);

	return (
		<aside id={id} class="ins-panel" aria-label="File details">
			<TabStrip
				label="File panel"
				tone="lane"
				class="ins-panel__tabs"
				items={INSPECT_PANEL_TABS}
				activeKey={tab}
				onSelect={choosePanelTab}
				panelId={body}
			/>
			<div id={body} class="ins-panel__body" role="tabpanel" aria-labelledby={`${body}-tab-${tab}`}>
				{tab === "view"
					? (
						<section class="ins-panel__section">
							{Controls ? <Controls /> : null}
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
							<ShortcutsDisclosure
								shortcuts={shortcuts}
								open={shortcutsOpen}
								summaryRef={shortcutsRef}
							/>
						</section>
					)
					: tab === "access"
					? <AccessSection shell={shell} titleId={accessTitle} />
					: (
						<>
							<DetailsSection shell={shell} titleId={detailsTitle} />
							<LinksSection shell={shell} titleId={linksTitle} />
						</>
					)}
			</div>
		</aside>
	);
}
