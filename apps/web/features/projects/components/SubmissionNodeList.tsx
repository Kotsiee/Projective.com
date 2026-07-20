import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import type { SubmissionTreeNode } from "../types/projects-types.ts";
import { nodeKindLabel, statusLabel, statusTone } from "../core/submission-model.ts";
import { FolderGlyph, StageGlyph, SubmissionStatusIcon, UnitGlyph } from "./submission-glyphs.tsx";

/**
 * SubmissionNodeList — the LIST-mode presentation of the current node's child nodes (Freelancers /
 * Submissions), the row counterpart to {@link FreelancerCard}/{@link SubmissionCard}. Each row is an
 * interactive button (a leading avatar for a submitter, else a kind glyph; name · sublabel · muted
 * count) that drills into the node. §B.4: transparent rows with a hover tint + a single bottom
 * hairline, no boxing. Token-only.
 */
export interface SubmissionNodeListProps {
	nodes: SubmissionTreeNode[];
	onOpen: (node: SubmissionTreeNode) => void;
}

function RowGlyph({ node }: { node: SubmissionTreeNode }): JSX.Element {
	if (node.kind === "stage") return <StageGlyph size={18} />;
	if (node.kind === "unit") return <UnitGlyph size={18} />;
	return <FolderGlyph size={18} />;
}

export function SubmissionNodeList({ nodes, onOpen }: SubmissionNodeListProps): JSX.Element {
	return (
		<div class="subm-nodelist" role="list" aria-label="Submissions">
			{nodes.map((node) => {
				const children = node.children.length;
				const count = children > 0
					? `${children} item${children === 1 ? "" : "s"}`
					: `${node.fileCount} file${node.fileCount === 1 ? "" : "s"}`;
				const sub = node.kind === "unit"
					? (node.status ? statusLabel(node.status) : nodeKindLabel(node.kind))
					: (node.sublabel ?? nodeKindLabel(node.kind));
				return (
					<button
						key={node.segment}
						type="button"
						class="subm-noderow"
						role="listitem"
						data-kind={node.kind}
						onClick={() => onOpen(node)}
						aria-label={`${node.label} — ${sub}, ${count}`}
					>
						<span class="subm-noderow__lead" aria-hidden="true">
							{node.kind === "submitter"
								? <Avatar image={node.avatar ?? undefined} label={node.label} size={28} alt="" />
								: <span class="subm-noderow__glyph"><RowGlyph node={node} /></span>}
						</span>
						<span class="subm-noderow__id">
							<span class="subm-noderow__name" title={node.label}>{node.label}</span>
							<span class="subm-noderow__sub">{sub}</span>
						</span>
						{node.kind === "unit" && node.status
							? (
								<span
									class="subm-noderow__status"
									data-tone={statusTone(node.status)}
									aria-hidden="true"
								>
									<SubmissionStatusIcon status={node.status} size={16} />
								</span>
							)
							: null}
						<span class="subm-noderow__count">{count}</span>
					</button>
				);
			})}
		</div>
	);
}
