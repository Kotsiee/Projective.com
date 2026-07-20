import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import type { SubmissionTreeNode } from "../types/projects-types.ts";

/**
 * FreelancerCard — a grid cell for a `submitter` tree node (Part 3, top level of a Submissions view).
 * A forced rounded-square avatar frame (1:1, matching FileCard's thumb geometry so both fit the same
 * VirtualGrid row height) over the freelancer's name, a "Freelancer" sublabel, and a muted submission /
 * file count. Selecting it drills into that freelancer's Submission Cards. Transparent at rest; hover
 * paints a subtle surface tint (interactive → highlight allowed, §B.4). Token-only.
 */
export interface FreelancerCardProps {
	node: SubmissionTreeNode;
	onOpen: (node: SubmissionTreeNode) => void;
}

export function FreelancerCard({ node, onOpen }: FreelancerCardProps): JSX.Element {
	const submissions = node.children.length;
	const countLabel = submissions > 0
		? `${submissions} submission${submissions === 1 ? "" : "s"}`
		: `${node.fileCount} file${node.fileCount === 1 ? "" : "s"}`;

	return (
		<button
			type="button"
			class="subm-card subm-card--freelancer"
			onClick={() => onOpen(node)}
			aria-label={`${node.label} — Freelancer, ${countLabel}`}
		>
			<span class="subm-card__thumb subm-card__thumb--avatar">
				<Avatar image={node.avatar ?? undefined} label={node.label} size={72} alt="" />
			</span>
			<span class="subm-card__meta">
				<span class="subm-card__name" title={node.label}>{node.label}</span>
				<span class="subm-card__sub">{node.sublabel ?? "Freelancer"}</span>
				<span class="subm-card__count">{countLabel}</span>
			</span>
		</button>
	);
}
