import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import type { FileChannelRef } from "../types/projects-types.ts";
import { ChannelHashIcon, DmBubbleIcon } from "./file-glyphs.tsx";

/**
 * FileChannelTree — the project-scope navigator. Channels are the TOP LEVEL of the tree (an "All
 * files" root above a "Channels" group), each an icon-led, selectable node with a muted file count.
 * Selecting a node scopes the workspace to that channel (or all). Icon-first + borderless: rows are
 * transparent, the active row a tonal tint, no boxing (§B.4/§B.6). Rendered inside the explorer island.
 */
export interface FileChannelTreeProps {
	channels: FileChannelRef[];
	/** The active channel id, or `null` for "All files". */
	active: Signal<string | null>;
	onSelect: (channelId: string | null) => void;
	total: number;
}

export function FileChannelTree(
	{ channels, active, onSelect, total }: FileChannelTreeProps,
): JSX.Element {
	return (
		<nav class="fx-tree" aria-label="Channels">
			<button
				type="button"
				class="fx-tree__node fx-tree__node--all"
				data-active={active.value === null ? "true" : undefined}
				aria-current={active.value === null ? "true" : undefined}
				onClick={() => onSelect(null)}
			>
				<span class="fx-tree__icon" aria-hidden="true">
					<ChannelHashIcon size={16} />
				</span>
				<span class="fx-tree__label">All files</span>
				<span class="fx-tree__count">{total}</span>
			</button>

			<div class="fx-tree__group" role="presentation">Channels</div>

			<div role="tree" aria-label="Project channels">
				{channels.map((c) => (
					<button
						key={c.id}
						type="button"
						role="treeitem"
						aria-selected={active.value === c.id}
						class="fx-tree__node"
						data-active={active.value === c.id ? "true" : undefined}
						onClick={() => onSelect(c.id)}
						title={c.name}
					>
						<span class="fx-tree__icon" aria-hidden="true">
							{c.kind === "dm" ? <DmBubbleIcon size={16} /> : <ChannelHashIcon size={16} />}
						</span>
						<span class="fx-tree__label">{c.name}</span>
						<span class="fx-tree__count">{c.count}</span>
					</button>
				))}
			</div>
		</nav>
	);
}
