import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import type { WorkspaceKind } from "@projective/types/workspace";
import { shortDate } from "../core/workspace-model.ts";
import { orgNodeMetrics } from "../core/members-model.ts";
import { type ChartNode, NODE_H, NODE_W } from "../core/org-chart-layout.ts";
import { PersonAvatar } from "./MemberCard.tsx";

/** The fold toggle under a manager's card, at zoom 1. */
export const FOLD_W = 44;
export const FOLD_H = 22;

/** Props for {@link OrgChartNode}. */
export interface OrgChartNodeProps {
	node: ChartNode;
	/** The member's role, as the roster names it. */
	role: string;
	kind: WorkspaceKind;
	/** The viewer sees payout stakes (a team's `manage_finances` holder). */
	showStake: boolean;
	tabbable: boolean;
	place: { pos: number; size: number };
	/** `true` picked out by the filter, `false` filtered out, `null` when nothing is filtered. */
	match: boolean | null;
	/** The member the inspector shows. */
	selected: boolean;
	onOpen: () => void;
	onToggle: () => void;
	onKeyDown: (event: JSX.TargetedKeyboardEvent<SVGGElement>) => void;
	onFocus: () => void;
}

/**
 * OrgChartNode — one person on the org chart (Decision #322): a fixed 220px card on the canvas, its
 * box an SVG rect (a stroke that keeps its screen width at every zoom) under an HTML body in a
 * `foreignObject`, so the avatar is the shared `Avatar` and long names cut with an ellipsis.
 *
 * Top row: the 36px avatar and the role in the section-header register (uppercase, `--text-2xs`) —
 * text, not a pill, since a role is what someone is rather than a state (§B.11). Middle: the name,
 * then `@handle` · title in the meta register. Foot: workload and stake as tabular figures. A manager
 * carries a fold toggle on the card's lower edge with the number of people below them.
 *
 * The node is a `treeitem` of the chart's flat tree; the fold is a pointer shortcut for what Left and
 * Right do from the keyboard, so it is hidden from the accessibility tree and the item says
 * `aria-expanded`.
 */
export function OrgChartNode(props: OrgChartNodeProps): JSX.Element {
	const { node, role, kind } = props;
	const { member } = node;
	const metrics = orgNodeMetrics(member, kind, props.showStake, shortDate(member.joinedAt));
	const below = `${node.descendants} ${node.descendants === 1 ? "person" : "people"} below`;
	const label = [
		member.name,
		member.title ? `${member.title}, ${role}` : role,
		member.isSelf ? "you" : "",
		...metrics.map((m) => m.text),
		node.reports > 0 ? `${below}${node.open ? "" : ", folded"}` : "",
		node.unplaced ? "not placed" : "",
	].filter(Boolean).join(", ");

	return (
		<g
			class="wsp-orgchart__node"
			transform={`translate(${node.x} ${node.y})`}
			role="treeitem"
			tabindex={props.tabbable ? 0 : -1}
			aria-level={node.level}
			aria-posinset={props.place.pos}
			aria-setsize={props.place.size}
			aria-expanded={node.reports > 0 ? node.open : undefined}
			aria-selected={props.selected}
			aria-label={label}
			data-id={member.id}
			data-self={member.isSelf ? "true" : undefined}
			data-match={props.match === true ? "true" : undefined}
			data-dim={props.match === false ? "true" : undefined}
			data-active={props.selected ? "true" : undefined}
			onClick={props.onOpen}
			onKeyDown={props.onKeyDown}
			onFocus={props.onFocus}
		>
			<title>{`${member.name} — ${role}`}</title>
			<g class="wsp-orgchart__press">
				<rect class="wsp-orgchart__card" width={NODE_W} height={NODE_H} />
				<foreignObject width={NODE_W} height={NODE_H} aria-hidden="true">
					<div class="wsp-orgnode">
						<div class="wsp-orgnode__top">
							<PersonAvatar member={member} size={36} class="wsp-orgnode__avatar" />
							<span class="wsp-orgnode__role">{role}</span>
						</div>
						<div class="wsp-orgnode__ident">
							<span class="wsp-orgnode__name">{member.name}</span>
							<MetaLine
								as="span"
								size="xs"
								class="wsp-orgnode__handle"
								items={[`@${member.handle}`, member.title]}
							/>
						</div>
						<MetaLine as="span" size="xs" class="wsp-orgnode__metrics" items={metrics} />
					</div>
				</foreignObject>
			</g>
			{node.reports > 0 && (
				<g
					class="wsp-orgchart__fold"
					transform={`translate(${NODE_W / 2 - FOLD_W / 2} ${NODE_H - FOLD_H / 2})`}
					data-open={node.open ? "true" : undefined}
					aria-hidden="true"
					onClick={(event) => {
						event.stopPropagation();
						props.onToggle();
					}}
				>
					<rect class="wsp-orgchart__foldmark" width={FOLD_W} height={FOLD_H} />
					<path
						class="wsp-orgchart__foldglyph"
						d={node.open ? "M10 13l4-4 4 4" : "M10 9l4 4 4-4"}
					/>
					<text class="wsp-orgchart__foldcount" x={FOLD_W - 13} y={FOLD_H / 2}>
						{node.descendants}
					</text>
				</g>
			)}
		</g>
	);
}
