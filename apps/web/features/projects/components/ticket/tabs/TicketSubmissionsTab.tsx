import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { useFrameState } from "@projective/ui/overlay";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import type {
	BoardCard,
	SubmissionCrumb,
	SubmissionTreeNode,
	TicketStageRef,
} from "../../../types/projects-types.ts";
import { filesZoom, gridColWidth, viewMode, zoom } from "../../../core/view-state.ts";
import { childrenAtPath, filesAtPath, nodeAtPath, ticketStack } from "../../../core/ticket-view.ts";
import { pathKey } from "../../../core/submission-model.ts";
import { FileCard } from "../../FileCard.tsx";
import { FreelancerCard } from "../../FreelancerCard.tsx";
import { SubmissionCard } from "../../SubmissionCard.tsx";
import { SubmissionNodeList } from "../../SubmissionNodeList.tsx";
import { ROOT_KEY, SubmissionTree } from "../../SubmissionTree.tsx";
import { SubmissionBreadcrumbs } from "../../SubmissionBreadcrumbs.tsx";
import { GridIcon, ListIcon } from "../../file-glyphs.tsx";

/**
 * TicketSubmissionsTab — the `/submissions` explorer, scoped strictly to one ticket.
 *
 * It mounts the SAME tree, cards, rows and file cards the standalone explorer does, and shares the
 * SAME zoom store — so the density a viewer chose on `/projects/[id]/submissions` is the density
 * they get here, `Ctrl`+wheel works identically, and crossing the centre marker transitions
 * list ⇄ grid without a second toggle competing with it.
 *
 * What it deliberately does NOT share is the virtualization. The explorer windows thousands of rows
 * against the page scroller; this tab lives inside a modal whose scroller is the modal body, and a
 * window-virtualized list inside a dialog measures the wrong box (the same class of bug the pop-out
 * chat hit). One ticket's deliverables are a bounded handful, so they render in full — no nested
 * scroll container, no measurement to get wrong.
 *
 * Clicking a submission does different things for the two sides of the market, because they came for
 * different reasons: a client is here to REVIEW, so a unit opens the review workspace at the
 * canonical `/projects/[id]/submissions/[stage]/[submitter]/[unit]` address; a freelancer is here to
 * see what they delivered, so a unit drills into its files.
 */
export interface TicketSubmissionsTabProps {
	card: BoardCard;
	/** The modal frame's identity — the browsed path is cached against it. */
	uid: number;
	/** Whether the viewer acts on the provider side (drills in, and may create a submission). */
	isFreelancer: boolean;
	/** The stages a submission can currently be made against. */
	activeStages: TicketStageRef[];
	onOpenSubmission: (path: string[]) => void;
	onCreateSubmission: (stageId: string) => void;
}

/** The crumb trail to a path, built from the ticket's own tree (no server round-trip). */
function crumbsFor(tree: SubmissionTreeNode[], path: string[]): SubmissionCrumb[] {
	const out: SubmissionCrumb[] = [{ label: "This ticket", kind: "stage", path: [] }];
	let nodes = tree;
	for (let i = 0; i < path.length; i++) {
		const node = nodes.find((n) => n.segment === path[i]);
		if (!node) break;
		out.push({ label: node.label, kind: node.kind, path: path.slice(0, i + 1) });
		nodes = node.children;
	}
	return out;
}

export function TicketSubmissionsTab(props: TicketSubmissionsTabProps): JSX.Element {
	const { card, isFreelancer, activeStages } = props;

	const path = useFrameState<string[]>(ticketStack, props.uid, "path", []);
	const expanded = useSignal<Set<string>>(new Set([ROOT_KEY]));
	const workspaceRef = useRef<HTMLDivElement>(null);
	useCtrlWheelZoom(workspaceRef, filesZoom);

	const current = nodeAtPath(card.submissions, path.value);
	const children = childrenAtPath(card.submissions, path.value);
	const files = filesAtPath(card, path.value);
	const rootCount = card.submissions.reduce((n, s) => n + s.fileCount, 0);
	// A container node drills into its children; a unit or a directory shows what is in it.
	const showsChildren = !current || (current.kind !== "unit" && current.kind !== "dir");

	function navigate(next: string[]): void {
		path.value = next;
		expanded.value = new Set([ROOT_KEY, ...expanded.value, ...ancestors(next)]);
	}

	/** Open a node: a client reviews a unit; everyone else navigates into it. */
	function openNode(node: SubmissionTreeNode): void {
		const next = [...path.value, node.segment];
		if (node.kind === "unit" && !isFreelancer) {
			props.onOpenSubmission(next);
			return;
		}
		navigate(next);
	}

	const canReviewHere = current?.kind === "unit" && !isFreelancer;

	return (
		<div class="tkv-subs">
			<div class="tkv-subs__bar">
				<div class="tkv-subs__trail">
					<SubmissionBreadcrumbs
						crumbs={crumbsFor(card.submissions, path.value)}
						base="#"
						onNavigate={navigate}
					/>
				</div>
				<ViewZoomRig
					store={filesZoom}
					label="Submission view zoom"
					listIcon={<ListIcon size={16} />}
					gridIcon={<GridIcon size={16} />}
					class="tkv-subs__zoom"
				/>
				{canReviewHere
					? (
						<Button
							variant="filled"
							size="sm"
							onClick={() => props.onOpenSubmission(path.value)}
						>
							Review submission
						</Button>
					)
					: null}
				{isFreelancer && activeStages.length > 0
					? (
						<Button
							variant="outlined"
							size="sm"
							onClick={() => props.onCreateSubmission(activeStages[0].stageId)}
						>
							Create submission
						</Button>
					)
					: null}
			</div>

			{card.submissions.length === 0
				? (
					<div class="tkv-empty">
						<Icon name="submission" size="lg" class="tkv-empty__mark" />
						<p class="tkv-empty__title">Nothing submitted yet</p>
						<p class="tkv-empty__note">
							{isFreelancer
								? activeStages.length > 0
									? "Work you deliver against this ticket will appear here, versioned and reviewable."
									: "This ticket has no stage running, so there is nothing to submit against yet."
								: "Deliverables submitted against this ticket will appear here for review."}
						</p>
						{isFreelancer && activeStages.length > 0
							? (
								<Button
									variant="filled"
									size="sm"
									onClick={() => props.onCreateSubmission(activeStages[0].stageId)}
								>
									Create submission
								</Button>
							)
							: null}
					</div>
				)
				: (
					<div class="tkv-subs__layout">
						<div class="tkv-subs__tree">
							<SubmissionTree
								tree={card.submissions}
								rootLabel="This ticket"
								rootCount={rootCount}
								currentPath={path.value}
								expanded={expanded}
								onNavigate={navigate}
							/>
						</div>

						<div class="tkv-subs__work" ref={workspaceRef}>
							{showsChildren
								? children.length === 0
									? <p class="tkv-empty tkv-empty--inline">Nothing here yet.</p>
									: viewMode.value === "grid"
									? (
										<div
											class="tkv-subs__grid"
											style={`--tkv-col:${gridColWidth(zoom.value)}px`}
										>
											{children.map((n) =>
												n.kind === "submitter"
													? <FreelancerCard key={n.segment} node={n} onOpen={openNode} />
													: <SubmissionCard key={n.segment} node={n} onOpen={openNode} />
											)}
										</div>
									)
									: <SubmissionNodeList nodes={children} onOpen={openNode} />
								: files.length === 0
								? <p class="tkv-empty tkv-empty--inline">This submission has no files.</p>
								: (
									<div class="tkv-subs__grid" style={`--tkv-col:${gridColWidth(zoom.value)}px`}>
										{files.map((f) => (
											<FileCard
												key={f.id}
												file={f}
												onOpen={() => globalThis.open(f.url, "_blank")}
											/>
										))}
									</div>
								)}
						</div>
					</div>
				)}
		</div>
	);

	/** Every ancestor path key of `next`, so navigating deep opens the whole chain in the tree. */
	function ancestors(next: string[]): string[] {
		const out: string[] = [];
		for (let i = 1; i <= next.length; i++) out.push(pathKey(next.slice(0, i)));
		return out;
	}
}
