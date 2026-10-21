import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import type { FileChannelRef } from "../types/projects-types.ts";
import { type FileTreeSelection, sameSelection } from "../core/file-tree-route.ts";
import { ChannelHashIcon, DmBubbleIcon, PaperclipIcon } from "./file-glyphs.tsx";

export type { FileTreeSelection };

/**
 * FileChannelTree — the project's file tree: an "All files" root, the client's "Project files"
 * beneath it, then the channels under a "Channels" group header (dropped on a Task, whose one room
 * needs no grouping). Each node is icon-led with a muted file count. Icon-first + borderless: rows are
 * transparent, the active row a tonal tint, no boxing (§B.4/§B.6). Rendered inside the explorer island,
 * in the shared `FilesFrame`'s left panel (Decision #317).
 *
 * Two modes. On the project's own Files route a node is a BUTTON that scopes the workspace in place
 * (`onSelect`; the island keeps `?in=` in step). On a channel's own Files route the same tree is drawn
 * with that channel selected and every node is a LINK to its own address (`hrefOf`), because choosing
 * another node there leaves the channel; a room the engagement cannot route is not offered.
 */
export interface FileChannelTreeProps {
	channels: FileChannelRef[];
	active: Signal<FileTreeSelection>;
	onSelect: (selection: FileTreeSelection) => void;
	total: number;
	/** How many project files the client has attached. */
	projectFileCount: number;
	/** The engagement is a Task: the channels render without their group header. */
	task: boolean;
	/** Each node's address, when the rows are links; `null` for a node that has none. */
	hrefOf?: (selection: FileTreeSelection) => string | null;
}

export function FileChannelTree(
	{ channels, active, onSelect, total, projectFileCount, task, hrefOf }: FileChannelTreeProps,
): JSX.Element {
	const sel = active.value;

	/** One row: a link to the node's address, or a button that scopes the workspace in place. */
	function node(
		selection: FileTreeSelection,
		body: ComponentChildren,
		extra: { class?: string; title?: string; treeitem?: boolean; key?: string },
	): JSX.Element | null {
		const on = sameSelection(sel, selection);
		const className = `fx-tree__node${extra.class ? ` ${extra.class}` : ""}`;
		if (hrefOf) {
			const href = hrefOf(selection);
			if (!href) return null;
			return (
				<a
					key={extra.key}
					href={href}
					role={extra.treeitem ? "treeitem" : undefined}
					aria-selected={extra.treeitem ? on : undefined}
					class={className}
					data-active={on ? "true" : undefined}
					aria-current={on ? "page" : undefined}
					title={extra.title}
				>
					{body}
				</a>
			);
		}
		return (
			<button
				key={extra.key}
				type="button"
				role={extra.treeitem ? "treeitem" : undefined}
				aria-selected={extra.treeitem ? on : undefined}
				class={className}
				data-active={on ? "true" : undefined}
				aria-current={!extra.treeitem && on ? "true" : undefined}
				onClick={() => onSelect(selection)}
				title={extra.title}
			>
				{body}
			</button>
		);
	}

	return (
		<nav class="fx-tree" aria-label="Files">
			{node(
				{ kind: "all" },
				<>
					<span class="fx-tree__icon" aria-hidden="true">
						<ChannelHashIcon size={16} />
					</span>
					<span class="fx-tree__label">All files</span>
					<span class="fx-tree__count">{total}</span>
				</>,
				{ class: "fx-tree__node--all" },
			)}

			{node(
				{ kind: "project" },
				<>
					<span class="fx-tree__icon" aria-hidden="true">
						<PaperclipIcon size={16} />
					</span>
					<span class="fx-tree__label">Project files</span>
					<span class="fx-tree__count">{projectFileCount}</span>
				</>,
				{ title: "Files the client attached to the project" },
			)}

			{!task && <div class="fx-tree__group" role="presentation">Channels</div>}

			<div
				role="tree"
				aria-label="Project channels"
				class={task ? "fx-tree__list fx-tree__list--ungrouped" : "fx-tree__list"}
			>
				{channels.map((c) =>
					node(
						{ kind: "channel", id: c.id },
						<>
							<span class="fx-tree__icon" aria-hidden="true">
								{c.kind === "dm" ? <DmBubbleIcon size={16} /> : <ChannelHashIcon size={16} />}
							</span>
							<span class="fx-tree__label">{c.name}</span>
							<span class="fx-tree__count">{c.count}</span>
						</>,
						{ key: c.id, title: c.name, treeitem: true },
					)
				)}
			</div>
		</nav>
	);
}
