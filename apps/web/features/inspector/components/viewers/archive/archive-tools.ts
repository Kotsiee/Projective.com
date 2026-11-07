import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import { formatBytes } from "@projective/types/contact";
import type { StageFact } from "../../../core/inspector-shell.ts";
import {
	type ArchiveNode,
	type ArchiveRow,
	archiveRows,
	type ArchiveTotals,
} from "../../../core/archive-tree.ts";

/** State of the archive canvas. */
export interface ArchiveTools {
	readonly root: Signal<ArchiveNode | null>;
	readonly expanded: Signal<ReadonlySet<string>>;
	/** The tree rows on show. */
	readonly rows: ReadonlySignal<readonly ArchiveRow[]>;
	/** The path of the row with the keyboard cursor. */
	readonly active: Signal<string | null>;
	readonly truncated: Signal<boolean>;
}

/** Fresh tools; the tree arrives once the stage has listed the file. */
export function createArchiveTools(): ArchiveTools {
	const root = signal<ArchiveNode | null>(null);
	const expanded = signal<ReadonlySet<string>>(new Set());
	return {
		root,
		expanded,
		rows: computed(() => (root.value ? archiveRows(root.value, expanded.value) : [])),
		active: signal<string | null>(null),
		truncated: signal(false),
	};
}

/** Open or close a folder. */
export function toggleFolder(tools: ArchiveTools, path: string): void {
	const next = new Set(tools.expanded.peek());
	if (!next.delete(path)) next.add(path);
	tools.expanded.value = next;
}

const COUNT = new Intl.NumberFormat("en-GB");

/** What the panel's Details says about an archive. */
export function archiveFacts(totals: ArchiveTotals, sizeBytes: number): StageFact[] {
	const facts: StageFact[] = [
		{ label: "Files", value: COUNT.format(totals.files) },
		{ label: "Folders", value: COUNT.format(totals.folders) },
		{ label: "Unpacked size", value: formatBytes(totals.size) },
	];
	const packed = totals.packedSize ?? sizeBytes;
	if (totals.size > 0 && packed < totals.size) {
		const saved = Math.round((1 - packed / totals.size) * 100);
		facts.push({ label: "Compression", value: `${saved}% smaller` });
	}
	return facts;
}
