import type { JSX } from "preact";
import type { SubmissionTreeNode } from "../types/projects-types.ts";
import { nodeKindLabel, statusLabel, statusTone } from "../core/submission-model.ts";
import { FolderGlyph, StageGlyph, SubmissionStatusIcon, UnitGlyph } from "./submission-glyphs.tsx";

/**
 * SubmissionCard — a grid cell for a non-submitter container node: a `unit` (a reviewable submission,
 * showing its review-status glyph) or a `stage`/`dir` (a structural container). A forced rounded-square
 * glyph frame (1:1, matching FileCard's thumb geometry) over the node's label, a kind/status sublabel,
 * and a muted child/file count. Selecting a unit opens its files; selecting a stage/dir drills deeper.
 * Transparent at rest; hover paints a subtle surface tint (interactive, §B.4). Token-only.
 */
export interface SubmissionCardProps {
	node: SubmissionTreeNode;
	onOpen: (node: SubmissionTreeNode) => void;
}

function GlyphFor({ node }: { node: SubmissionTreeNode }): JSX.Element {
	if (node.kind === "unit") return <UnitGlyph size={30} />;
	if (node.kind === "stage") return <StageGlyph size={30} />;
	return <FolderGlyph size={30} />;
}

export function SubmissionCard({ node, onOpen }: SubmissionCardProps): JSX.Element {
	const children = node.children.length;
	const countLabel = children > 0
		? `${children} item${children === 1 ? "" : "s"}`
		: `${node.fileCount} file${node.fileCount === 1 ? "" : "s"}`;
	const sub = node.kind === "unit"
		? (node.status ? statusLabel(node.status) : nodeKindLabel(node.kind))
		: (node.sublabel ?? nodeKindLabel(node.kind));

	return (
		<button
			type="button"
			class="subm-card subm-card--node"
			data-kind={node.kind}
			onClick={() => onOpen(node)}
			aria-label={`${node.label} — ${sub}, ${countLabel}`}
		>
			<span class="subm-card__thumb">
				<span class="subm-card__glyph" aria-hidden="true">
					<GlyphFor node={node} />
				</span>
				{node.kind === "unit" && node.status
					? (
						<span
							class="subm-card__status"
							data-tone={statusTone(node.status)}
							aria-hidden="true"
						>
							<SubmissionStatusIcon status={node.status} size={16} />
						</span>
					)
					: null}
			</span>
			<span class="subm-card__meta">
				<span class="subm-card__name" title={node.label}>{node.label}</span>
				<span class="subm-card__sub">{sub}</span>
				<span class="subm-card__count">{countLabel}</span>
			</span>
		</button>
	);
}
