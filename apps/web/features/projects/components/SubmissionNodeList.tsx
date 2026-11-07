import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { type DataColumn, DataTable, type DataTableProps } from "@projective/ui/display";
import type { Severity } from "@projective/ui/fields";
import type { SubmissionTreeNode } from "../types/projects-types.ts";
import { nodeKindLabel, statusLabel, statusTone } from "../core/submission-model.ts";
import { FolderGlyph, StageGlyph, SubmissionStatusIcon, UnitGlyph } from "./submission-glyphs.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * SubmissionNodeList — the LIST-mode presentation of the current node's child nodes (stages,
 * freelancers, submissions, folders), the row counterpart to {@link FreelancerCard}/
 * {@link SubmissionCard}, as a `DataTable` preset: Name (avatar or kind glyph, with the kind or
 * status beneath) · Status · Contents. A row drills into its node.
 */
export interface SubmissionNodeListProps {
	nodes: SubmissionTreeNode[];
	onOpen: (node: SubmissionTreeNode) => void;
	/** `dblclick`: a plain click selects and a double click opens (the `/files` hub). Default `click`. */
	openOn?: "click" | "dblclick";
	/** `false` drops the header row, for folder rows listed above a file table. */
	header?: boolean;
	/** A row's leading mark, when the host draws its own. */
	lead?: (node: SubmissionTreeNode) => JSX.Element;
	/** Per-node actions on a trailing kebab and on right-click. */
	rowActions?: DataTableProps<SubmissionTreeNode>["rowActions"];
	/** `data-*` attributes for a row, so a host can address it from outside the table. */
	rowAttrs?: DataTableProps<SubmissionTreeNode>["rowAttrs"];
	/** A host's styling token for a row, as `data-state`: unlike `rowAttrs`, a change re-renders it. */
	rowState?: DataTableProps<SubmissionTreeNode>["rowState"];
	/** A row's key, when the host selects rows by something other than their segment. */
	rowKey?: (node: SubmissionTreeNode) => string;
	/** Selected row keys; with `onSelectionChange`, rows select (a plain click still drills in). */
	selection?: readonly string[];
	onSelectionChange?: (keys: string[]) => void;
	"aria-label"?: string;
}

const TONE_SEVERITY: Record<ReturnType<typeof statusTone>, Severity> = {
	warning: "warning",
	danger: "danger",
	success: "success",
	muted: "secondary",
};

function itemCount(node: SubmissionTreeNode): number {
	return node.children.length > 0 ? node.children.length : node.fileCount;
}

function countLabel(node: SubmissionTreeNode): string {
	const n = itemCount(node);
	const noun = node.children.length > 0 ? "item" : "file";
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function NodeLead({ node }: { node: SubmissionTreeNode }): JSX.Element {
	if (node.kind === "submitter") {
		return <UserAvatar image={node.avatar ?? undefined} label={node.label} size={28} alt="" />;
	}
	if (node.kind === "stage") return <StageGlyph size={18} />;
	if (node.kind === "unit") return <UnitGlyph size={18} />;
	return <FolderGlyph size={18} />;
}

const NODE_COLUMNS: readonly DataColumn<SubmissionTreeNode>[] = [
	{
		id: "name",
		header: "Name",
		type: "text",
		fill: true,
		minWidth: 200,
		pinned: true,
		value: (node) => node.label,
		secondary: (node) =>
			node.kind === "unit"
				? (node.status ? statusLabel(node.status) : nodeKindLabel(node.kind))
				: (node.sublabel ?? nodeKindLabel(node.kind)),
		lead: (node) => <NodeLead node={node} />,
	},
	{
		id: "status",
		header: "Status",
		type: "status",
		width: 168,
		priority: 1,
		value: (node) =>
			node.kind === "unit" && node.status
				? {
					label: statusLabel(node.status),
					tone: TONE_SEVERITY[statusTone(node.status)],
					icon: <SubmissionStatusIcon status={node.status} size={14} />,
				}
				: null,
	},
	{
		id: "contents",
		header: "Contents",
		type: "custom",
		align: "end",
		width: 120,
		render: (node) => <span class="ui-dt__num">{countLabel(node)}</span>,
		sortValue: itemCount,
	},
];

const COLUMNS_WITHOUT_STATUS = NODE_COLUMNS.filter((column) => column.id !== "status");

export function SubmissionNodeList(props: SubmissionNodeListProps): JSX.Element {
	const hasStatus = props.nodes.some((node) => node.kind === "unit" && node.status);
	const base = hasStatus ? NODE_COLUMNS : COLUMNS_WITHOUT_STATUS;
	const columns = props.lead
		? base.map((column) => column.id === "name" ? { ...column, lead: props.lead } : column)
		: base;
	const selection = useMemo(() => new Set(props.selection ?? []), [props.selection]);
	const selectable = Boolean(props.onSelectionChange);
	return (
		<DataTable
			rows={props.nodes}
			rowKey={props.rowKey ?? ((node) => node.segment)}
			rowLabel={(node) => node.label}
			columns={columns}
			aria-label={props["aria-label"] ?? "Submissions"}
			header={props.header}
			onRowActivate={(node) => props.onOpen(node)}
			activateOn={props.openOn}
			rowActions={props.rowActions}
			rowAttrs={props.rowAttrs}
			rowState={props.rowState}
			selectionMode={selectable ? "multiple" : "none"}
			selection={selectable ? selection : undefined}
			onSelectionChange={props.onSelectionChange
				? (next) => props.onSelectionChange?.([...next])
				: undefined}
			rowHeight={56}
			virtualize={false}
			columnChooser={false}
			reorderable={false}
		/>
	);
}
