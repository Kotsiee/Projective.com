import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Tooltip } from "@projective/ui/feedback";
import type { WorkspaceMember, WorkspaceRoleDef } from "@projective/types/workspace";
import { sortMembers } from "../core/workspace-model.ts";
import { ChevronDownIcon, type MemberAction, PersonAvatar, roleNameOf } from "./MemberCard.tsx";

/**
 * OrgChart — the roster read as a reporting structure, built from each member's `reportsTo`.
 *
 * The connectors are **pure CSS** (see `workspace-people.css`): every stem is centred with
 * `inset-inline: 0; margin-inline: auto` and every sibling half-bar placed with `inset-inline-start` /
 * `inset-inline-end`, so the whole tree mirrors under `dir="rtl"` with no script and no second layout.
 * This component's only job is to turn a flat member list into the nested `ul`/`li` shape those rules
 * expect, and to keep it honest when the data is not a clean tree.
 *
 * **Three ways a `reportsTo` graph is not a tree, all surfaced rather than swallowed:**
 *   - a member whose manager is not in the roster (they left, or the row is stale),
 *   - a member inside a reporting CYCLE (A reports to B reports to A),
 *   - a roster where nobody has a null `reportsTo`, so there is no root at all.
 *
 * All three land in the "Not placed" group beneath the chart. Silently rooting them would draw an
 * organisation chart that quietly lies about who answers to whom, and dropping them would make the chart
 * show fewer people than the roster — a chart you cannot trust to be complete is worse than no chart.
 */

// #region Tree shaping
/** A node in the resolved reporting tree. */
interface ChartNode {
	member: WorkspaceMember;
	children: ChartNode[];
	/** Every descendant, so a collapsed node can honestly say how many people it hides. */
	descendants: number;
}

/** The resolved tree plus everyone it could not place. */
interface ChartShape {
	roots: ChartNode[];
	unplaced: WorkspaceMember[];
}

/**
 * Resolve the reporting tree.
 *
 * The cycle guard walks each member's manager chain up to `members.length` steps: a chain that revisits
 * the member it started from, or that is longer than the roster, cannot terminate at a root, so the
 * member is unplaced instead of recursed into. That bound is what makes this function total — a
 * self-referential row must not be able to hang the render.
 */
function shapeChart(members: readonly WorkspaceMember[]): ChartShape {
	const byId = new Map(members.map((m) => [m.id, m]));

	/** Whether following `reportsTo` from `member` terminates at a root inside the roster. */
	const reachesRoot = (member: WorkspaceMember): boolean => {
		const seen = new Set<string>([member.id]);
		let cursor = member.reportsTo;
		for (let step = 0; step <= members.length; step++) {
			if (cursor === null) return true;
			if (seen.has(cursor)) return false;
			const parent = byId.get(cursor);
			if (!parent) return false;
			seen.add(cursor);
			cursor = parent.reportsTo;
		}
		return false;
	};

	const placed = members.filter(reachesRoot);
	const unplaced = members.filter((m) => !placed.includes(m));

	const childrenOf = new Map<string, WorkspaceMember[]>();
	const rootMembers: WorkspaceMember[] = [];
	for (const member of placed) {
		if (member.reportsTo === null) {
			rootMembers.push(member);
			continue;
		}
		const siblings = childrenOf.get(member.reportsTo) ?? [];
		siblings.push(member);
		childrenOf.set(member.reportsTo, siblings);
	}

	const build = (member: WorkspaceMember): ChartNode => {
		const children = sortMembers(childrenOf.get(member.id) ?? []).map(build);
		const descendants = children.reduce((sum, c) => sum + 1 + c.descendants, 0);
		return { member, children, descendants };
	};

	return { roots: sortMembers(rootMembers).map(build), unplaced };
}
// #endregion

// #region Props
export interface OrgChartProps {
	members: readonly WorkspaceMember[];
	roles: readonly WorkspaceRoleDef[];
	onAction: (action: MemberAction, member: WorkspaceMember) => void;
}
// #endregion

// #region Nodes
/**
 * One node and its subtree.
 *
 * The card is the `treeitem` rather than the `<li>`, so the focus ring lands on the visible card the
 * reader is actually looking at; the `<li>` stays a layout wrapper (`role="none"`) that owns the
 * connector geometry. `Enter`/`Space` opens the member, `ArrowRight`/`ArrowLeft` expand and collapse —
 * so the tree is fully operable without ever needing the mouse to reach the small caret.
 */
function ChartBranch(props: {
	node: ChartNode;
	level: number;
	roles: readonly WorkspaceRoleDef[];
	openIds: ReadonlySet<string>;
	onToggle: (memberId: string) => void;
	onAction: (action: MemberAction, member: WorkspaceMember) => void;
}): JSX.Element {
	const { node, level, roles, openIds, onToggle, onAction } = props;
	const { member, children } = node;
	const hasChildren = children.length > 0;
	const open = hasChildren && openIds.has(member.id);
	const role = roleNameOf(member, roles);

	return (
		<li class="wsp-chart__node" role="none" data-open={open ? "true" : "false"}>
			<div
				class="wsp-chart__card"
				role="treeitem"
				tabIndex={0}
				aria-level={level}
				aria-expanded={hasChildren ? open : undefined}
				aria-label={`${member.name}, ${role}`}
				data-self={member.isSelf ? "true" : undefined}
				onClick={() => onAction("open", member)}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onAction("open", member);
						return;
					}
					if (!hasChildren) return;
					if (event.key === "ArrowRight" && !open) {
						event.preventDefault();
						onToggle(member.id);
					}
					if (event.key === "ArrowLeft" && open) {
						event.preventDefault();
						onToggle(member.id);
					}
				}}
			>
				<PersonAvatar member={member} size="sm" class="wsp-chart__avatar" />
				<span class="wsp-chart__body">
					<span class="wsp-chart__name">{member.name}</span>
					<span class="wsp-chart__role">{role}</span>
				</span>
				{hasChildren && (
					<>
						<Tooltip content={open ? "Hide reports" : `Show ${node.descendants} reporting below`}>
							<button
								type="button"
								class="wsp-chart__toggle"
								aria-label={open
									? `Hide the people reporting to ${member.name}`
									: `Show the ${node.descendants} people reporting to ${member.name}`}
								onClick={(event) => {
									event.stopPropagation();
									onToggle(member.id);
								}}
							>
								<span class="wsp-chart__toggle-glyph">
									<ChevronDownIcon />
								</span>
							</button>
						</Tooltip>
						<span class="wsp-chart__count wsp-num" aria-hidden="true">{node.descendants}</span>
					</>
				)}
			</div>

			{open && (
				<ul class="wsp-chart__level" role="group">
					{children.map((child) => (
						<ChartBranch
							key={child.member.id}
							node={child}
							level={level + 1}
							roles={roles}
							openIds={openIds}
							onToggle={onToggle}
							onAction={onAction}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
// #endregion

// #region Chart
/** The roster as a reporting tree. */
export function OrgChart(props: OrgChartProps): JSX.Element {
	const { members, roles, onAction } = props;
	const { roots, unplaced } = shapeChart(members);

	/**
	 * Collapsed ids, not expanded ones: a reporting structure is only useful when you can see it, so the
	 * chart opens fully and the reader closes branches they do not care about. Storing the inverse would
	 * make the first paint a wall of collapsed cards.
	 */
	const closed = useSignal<ReadonlySet<string>>(new Set<string>());
	const openIds = new Set(members.map((m) => m.id));
	for (const id of closed.value) openIds.delete(id);

	const toggle = (memberId: string) => {
		const next = new Set(closed.value);
		if (next.has(memberId)) next.delete(memberId);
		else next.add(memberId);
		closed.value = next;
	};

	return (
		<div class="wsp-chart" tabIndex={0} role="tree" aria-label="Reporting structure">
			{roots.length > 0 && (
				<ul class="wsp-chart__level wsp-chart__level--root" role="group">
					{roots.map((node) => (
						<ChartBranch
							key={node.member.id}
							node={node}
							level={1}
							roles={roles}
							openIds={openIds}
							onToggle={toggle}
							onAction={onAction}
						/>
					))}
				</ul>
			)}

			{unplaced.length > 0 && (
				<div class="wsp-chart__unassigned">
					<p class="wsp-label">Not placed</p>
					<p class="wsp-prose">
						{roots.length === 0
							? "Nobody in this roster reports to a member who is above them, so there is no top of the chart yet. Set a reporting line on one person to anchor it."
							: "Their reporting line points at somebody who is no longer in the roster, or back at themselves."}
					</p>
					<ul class="wsp-chart__level wsp-chart__level--root" role="group">
						{sortMembers(unplaced).map((member) => (
							<li key={member.id} class="wsp-chart__node" role="none">
								<div
									class="wsp-chart__card"
									role="treeitem"
									tabIndex={0}
									aria-level={1}
									aria-label={`${member.name}, ${roleNameOf(member, roles)}, not placed`}
									data-self={member.isSelf ? "true" : undefined}
									onClick={() =>
										onAction("open", member)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											onAction("open", member);
										}
									}}
								>
									<PersonAvatar member={member} size="sm" class="wsp-chart__avatar" />
									<span class="wsp-chart__body">
										<span class="wsp-chart__name">{member.name}</span>
										<span class="wsp-chart__role">{roleNameOf(member, roles)}</span>
									</span>
								</div>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
// #endregion
