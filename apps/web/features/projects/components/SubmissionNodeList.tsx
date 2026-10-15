import type { JSX } from "preact";
import { type DataColumn, DataTable } from "@projective/ui/display";
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
	/** `false` drops the header row, for folder rows listed above a file table. */
	header?: boolean;
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
	const columns = hasStatus ? NODE_COLUMNS : COLUMNS_WITHOUT_STATUS;
	return (
		<DataTable
			rows={props.nodes}
			rowKey={(node) => node.segment}
			rowLabel={(node) => node.label}
			columns={columns}
			aria-label={props["aria-label"] ?? "Submissions"}
			header={props.header}
			onRowActivate={(node) => props.onOpen(node)}
			rowHeight={56}
			virtualize={false}
			columnChooser={false}
			reorderable={false}
		/>
	);
}
