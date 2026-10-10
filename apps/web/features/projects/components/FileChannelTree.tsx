import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import type { FileChannelRef } from "../types/projects-types.ts";
import { ChannelHashIcon, DmBubbleIcon, PaperclipIcon } from "./file-glyphs.tsx";

/**
 * FileChannelTree — the project-scope navigator: an "All files" root, the client's "Project files"
 * beneath it, then the channels under a "Channels" group header (dropped on a Task, whose one room
 * needs no grouping). Each node is icon-led and selectable with a muted file count; selecting one
 * scopes the workspace. Icon-first + borderless: rows are transparent, the active row a tonal tint,
 * no boxing (§B.4/§B.6). Rendered inside the explorer island.
 */
export type FileTreeSelection =
	| { kind: "all" }
	| { kind: "project" }
	| { kind: "channel"; id: string };

export interface FileChannelTreeProps {
	channels: FileChannelRef[];
	active: Signal<FileTreeSelection>;
	onSelect: (selection: FileTreeSelection) => void;
	total: number;
	/** How many project files the client has attached. */
	projectFileCount: number;
	/** The engagement is a Task: the channels render without their group header. */
	task: boolean;
}

export function FileChannelTree(
	{ channels, active, onSelect, total, projectFileCount, task }: FileChannelTreeProps,
): JSX.Element {
	const sel = active.value;
	const isAll = sel.kind === "all";
	const isProject = sel.kind === "project";
	return (
		<nav class="fx-tree" aria-label="Files">
			<button
				type="button"
				class="fx-tree__node fx-tree__node--all"
				data-active={isAll ? "true" : undefined}
				aria-current={isAll ? "true" : undefined}
				onClick={() => onSelect({ kind: "all" })}
			>
				<span class="fx-tree__icon" aria-hidden="true">
					<ChannelHashIcon size={16} />
				</span>
				<span class="fx-tree__label">All files</span>
				<span class="fx-tree__count">{total}</span>
			</button>

			<button
				type="button"
				class="fx-tree__node"
				data-active={isProject ? "true" : undefined}
				aria-current={isProject ? "true" : undefined}
				onClick={() => onSelect({ kind: "project" })}
				title="Files the client attached to the project"
			>
				<span class="fx-tree__icon" aria-hidden="true">
					<PaperclipIcon size={16} />
				</span>
				<span class="fx-tree__label">Project files</span>
				<span class="fx-tree__count">{projectFileCount}</span>
			</button>

			{!task && <div class="fx-tree__group" role="presentation">Channels</div>}

			<div
				role="tree"
				aria-label="Project channels"
				class={task ? "fx-tree__list fx-tree__list--ungrouped" : "fx-tree__list"}
			>
				{channels.map((c) => {
					const on = sel.kind === "channel" && sel.id === c.id;
					return (
						<button
							key={c.id}
							type="button"
							role="treeitem"
							aria-selected={on}
							class="fx-tree__node"
							data-active={on ? "true" : undefined}
							onClick={() => onSelect({ kind: "channel", id: c.id })}
							title={c.name}
						>
							<span class="fx-tree__icon" aria-hidden="true">
								{c.kind === "dm" ? <DmBubbleIcon size={16} /> : <ChannelHashIcon size={16} />}
							</span>
							<span class="fx-tree__label">{c.name}</span>
							<span class="fx-tree__count">{c.count}</span>
						</button>
					);
				})}
			</div>
		</nav>
	);
}
