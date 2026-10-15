import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { type DataColumn, DataTable } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import {
	CAPABILITY_LABEL,
	type PermissionFacet,
	type WorkspaceMember,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { shortDate } from "../core/workspace-model.ts";
import {
	availabilityPhrase,
	isConsequential,
	type MemberAction,
	type MemberGuards,
	memberMenuRows,
	memberProfileHref,
	MembershipDot,
	OverrideChip,
	PermissionsIcon,
	PersonAvatar,
	roleNameOf,
	WorkloadMeter,
} from "./MemberCard.tsx";

/**
 * MemberTable — the roster at table density: the same people as the cards, read for comparison rather
 * than for identity, as a `DataTable` preset. Five columns, one per question a reader brings to a
 * roster — who they are, what role they hold, how their effective permissions differ from it, how
 * loaded they are, and what can be done about it. The identity column stays pinned while the table
 * scrolls sideways; a row opens the member drawer; the card's menu rides on a kebab and right-click.
 */

// #region Props
export interface MemberTableProps {
	members: readonly WorkspaceMember[];
	roles: readonly WorkspaceRoleDef[];
	/** Per-member capability breakdown, keyed by member id — from the SSOT's `permissionFacets`. */
	facetsById: Record<string, readonly PermissionFacet[]>;
	/** Per-member authority guards, keyed by member id. */
	guardsById: Record<string, MemberGuards>;
	/** Selected member ids for bulk role change / removal. Omit `onSelect` to hide the controls. */
	selected?: ReadonlySet<string>;
	onSelect?: (memberId: string, next: boolean) => void;
	onSelectAll?: (next: boolean) => void;
	onAction: (action: MemberAction, member: WorkspaceMember) => void;
	/** Server-resolved reference year so an SSR date and its hydration agree across a New Year. */
	referenceYear?: number;
}
// #endregion

// #region Permission summary cell
/**
 * The permissions column.
 *
 * It leads with the OVERRIDES, because the only thing a reader cannot infer from a role name is where a
 * member departs from it. When there are none it says so plainly rather than leaving the cell blank — an
 * empty cell on a permission table reads as "not loaded", not as "nothing unusual". A member with no
 * overrides but consequential capabilities still gets those flagged, so "this person can move money" is
 * never something you have to open a drawer to discover.
 */
function PermissionSummary(props: { facets: readonly PermissionFacet[] }): JSX.Element {
	const { facets } = props;

	const overrides = facets.filter((f) => f.override !== null);
	if (overrides.length > 0) {
		const shown = overrides.slice(0, 2);
		const rest = overrides.length - shown.length;
		return (
			<div class="wsp-mtable__perms">
				{shown.map((facet) => <OverrideChip key={facet.capability} facet={facet} />)}
				{rest > 0 && (
					<Tooltip
						content={overrides.slice(2).map((f) => CAPABILITY_LABEL[f.capability]).join(", ")}
					>
						<span class="wsp-override wsp-num">{`+${rest}`}</span>
					</Tooltip>
				)}
			</div>
		);
	}

	const severe = facets.filter((f) => f.effective && isConsequential(f.capability));
	if (severe.length > 0) {
		return (
			<div class="wsp-mtable__perms">
				<Tooltip content={severe.map((f) => CAPABILITY_LABEL[f.capability]).join(", ")}>
					<span class="wsp-capchip" data-level="consequential">
						{`Role default · ${severe.length} sensitive`}
					</span>
				</Tooltip>
			</div>
		);
	}

	return <div class="wsp-mtable__perms">Role default</div>;
}
// #endregion

// #region Cells
function IdentityCell({ member }: { member: WorkspaceMember }): JSX.Element {
	return (
		<div class="wsp-mtable__ident">
			<Tooltip content={`${member.name} — ${availabilityPhrase(member.availability)}`}>
				<span class="wsp-mcard__avatarwrap">
					<PersonAvatar member={member} size="sm" />
					<span class="wsp-mcard__avail" data-avail={member.availability} aria-hidden="true" />
				</span>
			</Tooltip>
			<span class="wsp-mtable__name">
				<span class="wsp-mtable__name-text">{member.name}</span>
				<a class="wsp-mtable__sub" href={memberProfileHref(member.handle)}>{`@${member.handle}`}</a>
			</span>
		</div>
	);
}

function RoleCell(
	{ member, role, referenceYear }: {
		member: WorkspaceMember;
		role: string;
		referenceYear?: number;
	},
): JSX.Element {
	return (
		<span class="wsp-mtable__name">
			<span class="wsp-mtable__name-text">
				{role}
				<MembershipDot state={member.state} />
			</span>
			<span class="wsp-mtable__sub wsp-num">{shortDate(member.joinedAt, referenceYear)}</span>
		</span>
	);
}
// #endregion

// #region Table
/** The roster, at table density. */
export function MemberTable(props: MemberTableProps): JSX.Element {
	const { members, roles, facetsById, guardsById, selected, onSelect, onSelectAll, onAction } =
		props;
	const { referenceYear } = props;

	const columns = useMemo<DataColumn<WorkspaceMember>[]>(() => [
		{
			id: "member",
			header: "Member",
			type: "custom",
			fill: true,
			minWidth: 224,
			pinned: true,
			render: (member) => <IdentityCell member={member} />,
			sortValue: (member) => member.name,
			searchText: (member) => `${member.name} @${member.handle}`,
		},
		{
			id: "role",
			header: "Role",
			type: "custom",
			width: 176,
			render: (member) => (
				<RoleCell member={member} role={roleNameOf(member, roles)} referenceYear={referenceYear} />
			),
			sortValue: (member) => roleNameOf(member, roles),
		},
		{
			id: "permissions",
			header: "Permissions",
			type: "custom",
			width: 208,
			priority: 2,
			render: (member) => <PermissionSummary facets={facetsById[member.id] ?? []} />,
		},
		{
			id: "workload",
			header: "Workload",
			type: "custom",
			width: 152,
			priority: 1,
			render: (member) => <WorkloadMeter workload={member.workload} />,
		},
		{
			id: "access",
			header: "Role and permissions",
			headerHidden: true,
			type: "custom",
			align: "end",
			width: 56,
			resizable: false,
			reorderable: false,
			render: (member) => (
				<Tooltip content={`Role and permissions for ${member.name}`}>
					<button
						type="button"
						class="wsp-mcard__kebab"
						aria-label={`Role and permissions for ${member.name}`}
						onClick={() => onAction("open", member)}
					>
						<PermissionsIcon />
					</button>
				</Tooltip>
			),
		},
	], [roles, facetsById, referenceYear, onAction]);

	const selectable = Boolean(onSelect && onSelectAll);
	const onSelectionChange = (next: ReadonlySet<string>) => {
		if (!onSelect || !onSelectAll) return;
		if (next.size === 0) return onSelectAll(false);
		if (members.every((m) => next.has(m.id))) return onSelectAll(true);
		for (const member of members) {
			const was = selected?.has(member.id) ?? false;
			const now = next.has(member.id);
			if (was !== now) onSelect(member.id, now);
		}
	};

	return (
		<DataTable
			class="wsp-mtable"
			rows={members}
			rowKey={(member) => member.id}
			rowLabel={(member) => member.name}
			columns={columns}
			aria-label="Members table"
			selectionMode={selectable ? "multiple" : "none"}
			selection={selectable ? selected ?? new Set() : undefined}
			onSelectionChange={selectable ? onSelectionChange : undefined}
			onRowActivate={(member) => onAction("open", member)}
			rowActions={(member) =>
				memberMenuRows(
					member,
					guardsById[member.id] ?? { manageable: false, lastOwner: false },
					onAction,
				)}
			rowState={(member) => (member.isSelf ? "self" : null)}
			rowHeight={64}
			virtualize={false}
			columnChooser={false}
		/>
	);
}
// #endregion
