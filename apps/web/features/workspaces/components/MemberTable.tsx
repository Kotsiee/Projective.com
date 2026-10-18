import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { computed } from "@preact/signals";
import { type DataColumn, DataTable, MetaLine } from "@projective/ui/display";
import type { MenuItem } from "@projective/ui/navigation";
import {
	type PermissionFacet,
	roleRank,
	type WorkspaceMember,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { overrideSummary, roleText, stakePercent, workloadText } from "../core/members-model.ts";
import { peopleZoom } from "../core/view-state.ts";
import { OverrideLine, PersonAvatar } from "./MemberCard.tsx";

/**
 * MemberTable — the People reading's default: the roster as a `DataTable` (Decision #224), read for
 * comparison. One column per question a reader brings to a roster — who (Member: avatar, name, the
 * handle as meta), what they may do (Role — a custom role reads "Name · based on Lead" — and how their
 * effective set departs from it: Overrides), what they are owed (Stake, only for a viewer who reads
 * payouts), how loaded they are (Workload, live W_i over their cap) and how long they have been here
 * (Joined) — with the row's menu on the table's own kebab and right-click (Decision #222).
 *
 * Sorting is the table's own header sort; a row opens the member drawer on click or Enter, and the
 * drawer hands focus back to the row when it closes. Every value comes from `core/members-model.ts`.
 *
 * On a narrow table the DataTable hides the LOWEST priority first, so the numbers rank what a reader
 * keeps longest: Joined goes first, then Stake, then Overrides, and Workload — the one live figure —
 * last. Member and Role carry no priority and never hide. The declared widths sum to fit the 1440
 * People reading with the lane open, so every column shows there for every viewer.
 */

// #region Props
export interface MemberTableProps {
	members: readonly WorkspaceMember[];
	roles: readonly WorkspaceRoleDef[];
	/** Per-member capability breakdown, keyed by member id — from the SSOT's `permissionFacets`. */
	facetsById: Readonly<Record<string, readonly PermissionFacet[]>>;
	/** A row's menu (`memberMenu`) — only what the viewer may do. */
	menuFor: (member: WorkspaceMember) => readonly MenuItem[];
	/** Whether the viewer reads payout stakes (`showsStake`) — the Stake column exists only then. */
	showStake: boolean;
	/** Open the member drawer. */
	onOpen: (member: WorkspaceMember) => void;
}

/** The row height the People zoom's list half sets — a signal, so a zoom re-measures the table. */
const ROW_HEIGHT = computed(() => peopleZoom.listRowHeight(peopleZoom.displayZoom.value));
// #endregion

// #region Cells
/** A figure cell: right-aligned, tabular, with optional meta after it. */
function Figure(props: { text: string; meta?: string | false }): JSX.Element {
	return (
		<span class="wsp-mtable__figure">
			<span class="wsp-mtable__value">{props.text}</span>
			{props.meta && <MetaLine as="span" size="xs" items={[props.meta]} />}
		</span>
	);
}
// #endregion

// #region Table
/** The roster, at table density. */
export function MemberTable(props: MemberTableProps): JSX.Element {
	const { members, roles, facetsById, menuFor, showStake, onOpen } = props;

	const columns = useMemo<DataColumn<WorkspaceMember>[]>(() => {
		const cols: DataColumn<WorkspaceMember>[] = [
			{
				id: "member",
				header: "Member",
				type: "text",
				fill: true,
				minWidth: 220,
				pinned: true,
				value: (member) => member.name,
				secondary: (member) => member.isSelf ? `@${member.handle} · You` : `@${member.handle}`,
				lead: (member) => <PersonAvatar member={member} size="sm" />,
				searchText: (member) => `${member.name} @${member.handle}`,
			},
			{
				id: "role",
				header: "Role",
				type: "custom",
				width: 208,
				render: (member) => <span class="wsp-mtable__text">{roleText(member, roles)}</span>,
				// Authority first: an ascending sort leads with the owner, ties by role name.
				sortValue: (member) =>
					`${9 - roleRank(member.rolePreset)}:${
						roleText(member, roles).toLocaleLowerCase("en-GB")
					}`,
				searchText: (member) => roleText(member, roles),
			},
			{
				id: "overrides",
				header: "Overrides",
				type: "custom",
				width: 196,
				priority: 3,
				firstSortDir: "desc",
				render: (member) => (
					<OverrideLine
						facets={facetsById[member.id] ?? []}
						showDefault
						class="wsp-mtable__overrides"
					/>
				),
				sortValue: (member) => {
					const s = overrideSummary(facetsById[member.id] ?? []);
					return s.granted.length + s.revoked.length;
				},
			},
		];
		if (showStake) {
			cols.push({
				id: "stake",
				header: "Stake",
				type: "custom",
				width: 112,
				align: "end",
				priority: 2,
				firstSortDir: "desc",
				render: (member) => (
					<Figure text={stakePercent(member.shareBp)} meta={member.shareHeld && "held"} />
				),
				sortValue: (member) => member.shareBp,
			});
		}
		cols.push(
			{
				id: "workload",
				header: "Workload",
				type: "custom",
				width: 112,
				align: "end",
				priority: 4,
				firstSortDir: "desc",
				render: (member) => <Figure text={workloadText(member)} />,
				sortValue: (member) => member.wiCap > 0 ? member.wi / member.wiCap : member.wi,
			},
			{
				id: "joined",
				header: "Joined",
				type: "date",
				format: "relative",
				width: 112,
				priority: 1,
				value: (member) => member.joinedAt,
			},
		);
		return cols;
	}, [roles, facetsById, showStake]);

	return (
		<DataTable
			class="wsp-mtable"
			rows={members}
			rowKey={(member) => member.id}
			rowLabel={(member) => member.name}
			columns={columns}
			aria-label="Members"
			onRowActivate={(member) => onOpen(member)}
			rowActions={menuFor}
			rowState={(member) => (member.isSelf ? "self" : null)}
			rowHeight={ROW_HEIGHT}
			virtualize={false}
			columnChooser={false}
		/>
	);
}
// #endregion
