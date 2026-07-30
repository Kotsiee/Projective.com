import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Checkbox } from "@projective/ui/fields";
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
	MemberActionsMenu,
	type MemberGuards,
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
 * than for identity.
 *
 * Five columns, one per question a reader brings to a roster — who they are, what role they hold, how
 * their effective permissions differ from it, how loaded they are, and what can be done about it. The
 * wrapper is the ONLY horizontal scroller (the page body must never scroll sideways) and the identity
 * column is sticky, because a permission row read across five columns is useless the moment the name
 * slides out of view.
 *
 * **Semantics:** `role="table"` over real rows and cells, not a grid. A grid would promise per-cell
 * arrow-key navigation, which this table does not implement and does not need — that contract belongs to
 * the roles matrix, where two axes genuinely have to be traversed. Each row is nonetheless directly
 * operable: `Enter`/`Space` opens the member drawer, and every control inside a row stops propagation so
 * ticking a checkbox never doubles as activating the row.
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

// #region Table
/** The roster, at table density. */
export function MemberTable(props: MemberTableProps): JSX.Element {
	const {
		members,
		roles,
		facetsById,
		guardsById,
		selected,
		onSelect,
		onSelectAll,
		onAction,
		referenceYear,
	} = props;

	const allSelected = members.length > 0 && members.every((m) => selected?.has(m.id));

	return (
		<div class="wsp-mtable" tabIndex={0} role="region" aria-label="Members table">
			<div class="wsp-mtable__grid" role="table" aria-rowcount={members.length + 1}>
				<div class="wsp-mtable__head" role="row" aria-rowindex={1}>
					<div class="wsp-mtable__th" role="columnheader">
						{onSelect && onSelectAll && (
							<Checkbox
								value={allSelected}
								onValueChange={(next) => onSelectAll(next)}
								aria-label={allSelected ? "Clear selection" : "Select every member shown"}
							/>
						)}
						Member
					</div>
					<div class="wsp-mtable__th" role="columnheader">Role</div>
					<div class="wsp-mtable__th" role="columnheader">Permissions</div>
					<div class="wsp-mtable__th" role="columnheader">Workload</div>
					<div class="wsp-mtable__th" role="columnheader" data-align="end">
						<span class="wsp-sr">Actions</span>
					</div>
				</div>

				{members.map((member, index) => {
					const role = roleNameOf(member, roles);
					const facets = facetsById[member.id] ?? [];
					const guards = guardsById[member.id] ?? { manageable: false, lastOwner: false };
					const isSelected = selected?.has(member.id) ?? false;

					return (
						<div
							key={member.id}
							class="wsp-mtable__row"
							role="row"
							aria-rowindex={index + 2}
							tabIndex={0}
							data-self={member.isSelf ? "true" : undefined}
							onClick={() => onAction("open", member)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onAction("open", member);
								}
							}}
						>
							<div class="wsp-mtable__cell" role="cell">
								<div class="wsp-mtable__ident">
									{onSelect && (
										<span onClick={(event) => event.stopPropagation()}>
											<Checkbox
												value={isSelected}
												onValueChange={(next) => onSelect(member.id, next)}
												aria-label={`Select ${member.name}`}
											/>
										</span>
									)}
									<Tooltip
										content={`${member.name} — ${availabilityPhrase(member.availability)}`}
									>
										<span class="wsp-mcard__avatarwrap">
											<PersonAvatar member={member} size="sm" />
											<span
												class="wsp-mcard__avail"
												data-avail={member.availability}
												aria-hidden="true"
											/>
										</span>
									</Tooltip>
									<span class="wsp-mtable__name">
										<span class="wsp-mtable__name-text">{member.name}</span>
										<a
											class="wsp-mtable__sub"
											href={memberProfileHref(member.handle)}
											onClick={(event) => event.stopPropagation()}
										>
											{`@${member.handle}`}
										</a>
									</span>
								</div>
							</div>

							<div class="wsp-mtable__cell" role="cell">
								<span class="wsp-mtable__name">
									<span class="wsp-mtable__name-text">
										{role}
										<MembershipDot state={member.state} />
									</span>
									<span class="wsp-mtable__sub wsp-num">
										{shortDate(member.joinedAt, referenceYear)}
									</span>
								</span>
							</div>

							<div class="wsp-mtable__cell" role="cell">
								<PermissionSummary facets={facets} />
							</div>

							<div class="wsp-mtable__cell" role="cell">
								<WorkloadMeter workload={member.workload} />
							</div>

							<div class="wsp-mtable__cell" role="cell" data-align="end">
								<div class="wsp-mtable__actions" onClick={(e) => e.stopPropagation()}>
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
									<MemberActionsMenu member={member} guards={guards} onAction={onAction} />
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
// #endregion
