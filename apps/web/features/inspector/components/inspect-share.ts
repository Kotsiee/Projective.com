import { canShareAsLink } from "@projective/types/files";
import { dismissShare } from "@features/share/core/share-request.ts";
import type { ShareTarget } from "@features/share/core/share-menu.ts";
import type { InspectorShell } from "../core/inspector-shell.ts";
import { reachOf } from "../core/access-live.ts";
import { shareTargetOf } from "../core/inspector-model.ts";
import { choosePanelTab } from "../core/panel-tab.ts";

/** Close the share modal and show the panel's Access tab (Decision #402). */
export function openAccessPanel(shell: InspectorShell): void {
	dismissShare();
	shell.panelOpen.value = true;
	choosePanelTab("access");
}

/**
 * What the inspector's Share controls share — the bar's button and the canvas menu's row alike: the
 * address {@link shareTargetOf} picks from the file's latest reach, and, for the file's manager on the
 * standalone page, the way to the Access tab. A host (the preview modal) has no Access tab.
 */
export function inspectShareTarget(shell: InspectorShell): ShareTarget {
	const { asset } = shell;
	const target = shareTargetOf(asset, reachOf(asset));
	const manages = asset.canManage && !shell.options.embedded;
	return {
		title: asset.name,
		href: target.href,
		file: { id: asset.id, canLink: canShareAsLink(asset) },
		reach: target.reach,
		manageAccess: manages ? () => openAccessPanel(shell) : undefined,
	};
}
