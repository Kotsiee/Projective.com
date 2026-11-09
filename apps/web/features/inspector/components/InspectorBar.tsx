import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Logo } from "@web/components/Logo.tsx";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";
import { requestShare } from "@features/share/core/share-request.ts";
import type { InspectorShell } from "../core/inspector-shell.ts";
import { metaLine } from "../core/inspector-model.ts";
import { useInspectorActions } from "./InspectorContext.ts";
import { ToolButton } from "./controls/ToolButton.tsx";
import { inspectShareTarget } from "./inspect-share.ts";

/** Props for {@link InspectorBar}. */
export interface InspectorBarProps {
	shell: InspectorShell;
	/** Below `--bp-md`: the download collapses to an icon. */
	compact: boolean;
	/** The id of the panel the toggle controls. */
	panelId: string;
}

/**
 * The inspector's only chrome: home mark, file name and facts, then share, download, fullscreen, the
 * light/dark switch and the panel. Share opens the one share modal on the address the file's latest
 * reach allows (Decision #402).
 */
export function InspectorBar({ shell, compact, panelId }: InspectorBarProps): JSX.Element {
	const { asset } = shell;
	const actions = useInspectorActions();
	const fullscreen = shell.fullscreen.value;
	const panelOpen = shell.panelOpen.value;
	const share = () => requestShare({ ...inspectShareTarget(shell), noun: "file" });

	return (
		<header class="ins-bar">
			<div class="ins-bar__start">
				<a class="ins-bar__home" href="/" aria-label="Projective — home">
					<Logo class="ins-bar__mark" />
				</a>
				<div class="ins-bar__title">
					<Tooltip content={asset.name} whenTruncated>
						<h1 class="ins-bar__name">{asset.name}</h1>
					</Tooltip>
					<p class="ins-bar__meta">{metaLine(asset)}</p>
				</div>
			</div>
			<div class="ins-bar__end">
				{compact
					? (
						<>
							<ToolButton icon="share" label="Share" onClick={share} />
							<ToolButton icon="download" label="Download" onClick={actions.download} />
						</>
					)
					: (
						<>
							<Button
								size="sm"
								severity="neutral"
								variant="outlined"
								icon={<Icon name="share" size="sm" />}
								label="Share"
								onClick={share}
							/>
							<Button
								size="sm"
								severity="neutral"
								variant="outlined"
								icon={<Icon name="download" size="sm" />}
								label="Download"
								onClick={actions.download}
							/>
						</>
					)}
				<ToolButton
					icon={fullscreen ? "collapse" : "expand"}
					label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
					shortcut="F"
					onClick={() => shell.toggleFullscreen()}
				/>
				<ThemeToggle />
				<Tooltip content={panelOpen ? "Hide details (I)" : "Show details (I)"}>
					<Button
						iconOnly
						rounded
						size="sm"
						variant="text"
						severity="secondary"
						class="ins-tool-button ui-hit"
						icon={<Icon name="panel-right" size="sm" />}
						aria-label="Details panel"
						aria-pressed={panelOpen}
						aria-controls={panelId}
						aria-keyshortcuts="I"
						data-pressed={panelOpen ? "true" : undefined}
						onClick={() => shell.togglePanel()}
					/>
				</Tooltip>
			</div>
		</header>
	);
}
