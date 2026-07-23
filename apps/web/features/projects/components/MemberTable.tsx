import type { JSX, VNode } from "preact";
import type { Signal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import type { MemberScope, ProjectMemberRow } from "../types/projects-types.ts";
import type { MemberSortKey } from "../core/member-model.ts";
import { AssignmentTag, MemberRoleBadge, PresenceDot } from "./MemberBadges.tsx";
import { ChevronIcon } from "./glyphs.tsx";

/**
 * MemberTable — the dense roster table (task §2.1). A real `<table>` for accessibility: sortable column
 * headers are buttons wiring `aria-sort`; each row shows the avatar (+ presence dot), name/handle, role
 * badge, email, the stage relationship (Assignment on a stage channel · assigned-stage chips in project
 * scope), workload, join date, and — when the viewer manages — the per-row actions menu. Presentation
 * only; all behaviour flows through the injected {@link MemberTableProps.renderActions} slot + `onSort`.
 */
export interface MemberTableProps {
	members: ProjectMemberRow[];
	scope: MemberScope;
	/** Channel scope on a STAGE channel — shows the Assignment (contributor/observer) column. */
	stageChannel: boolean;
	sortKey: Signal<MemberSortKey>;
	sortDir: Signal<"asc" | "desc">;
	onSort: (key: MemberSortKey) => void;
	/** Renders the row actions menu when the viewer can manage; returns null to omit the cell content. */
	renderActions?: (m: ProjectMemberRow) => VNode | null;
	/** Whether the actions column is shown at all (any row manageable). */
	showActions: boolean;
}

interface SortHeaderProps {
	label: string;
	col: MemberSortKey;
	active: boolean;
	dir: "asc" | "desc";
	onSort: (key: MemberSortKey) => void;
}

function SortHeader({ label, col, active, dir, onSort }: SortHeaderProps): JSX.Element {
	return (
		<th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
			<button
				type="button"
				class="mem-th"
				data-active={active ? "true" : undefined}
				onClick={() => onSort(col)}
			>
				<span>{label}</span>
				<span class="mem-th__caret" data-dir={active ? dir : undefined} aria-hidden="true">
					{ChevronIcon}
				</span>
			</button>
		</th>
	);
}

export function MemberTable(props: MemberTableProps): JSX.Element {
	const { members, scope, stageChannel, sortKey, sortDir, onSort, showActions } = props;
	const stageCol = scope === "channel" && stageChannel;

	return (
		<div class="mem-table-wrap">
			<table class="mem-table">
				<thead>
					<tr>
						<SortHeader
							label="Member"
							col="name"
							active={sortKey.value === "name"}
							dir={sortDir.value}
							onSort={onSort}
						/>
						<SortHeader
							label="Role"
							col="role"
							active={sortKey.value === "role"}
							dir={sortDir.value}
							onSort={onSort}
						/>
						<th scope="col" class="mem-col--email">Email</th>
						<th scope="col">{stageCol ? "Assignment" : "Assigned stages"}</th>
						<SortHeader
							label="Tickets"
							col="tickets"
							active={sortKey.value === "tickets"}
							dir={sortDir.value}
							onSort={onSort}
						/>
						<SortHeader
							label="Joined"
							col="joined"
							active={sortKey.value === "joined"}
							dir={sortDir.value}
							onSort={onSort}
						/>
						{showActions && (
							<th scope="col" class="mem-col--actions">
								<span class="ui-visually-hidden">Actions</span>
							</th>
						)}
					</tr>
				</thead>
				<tbody>
					{members.map((m) => (
						<tr key={m.id} class="mem-row" data-viewer={m.isViewer ? "true" : undefined}>
							<td>
								<div class="mem-identity">
									<span class="mem-identity__avatar">
										<Avatar image={m.party.avatar ?? undefined} label={m.party.name} size="md" />
										<PresenceDot presence={m.presence} />
									</span>
									<span class="mem-identity__text">
										<span class="mem-identity__name">
											{m.party.name}
											{m.isViewer && <span class="mem-identity__you">You</span>}
										</span>
										{m.party.handle && <span class="mem-identity__handle">@{m.party.handle}</span>}
									</span>
								</div>
							</td>
							<td>
								<MemberRoleBadge role={m.role} />
							</td>
							<td class="mem-col--email">
								<a class="mem-email" href={`mailto:${m.email}`}>{m.email}</a>
							</td>
							<td>
								{stageCol
									? (m.assignment
										? <AssignmentTag assignment={m.assignment} />
										: <span class="mem-dash">—</span>)
									: (m.assignedStages.length > 0
										? (
											<span class="mem-stages">
												{m.assignedStages.map((s) => <span key={s} class="mem-stagechip">{s}
												</span>)}
											</span>
										)
										: <span class="mem-dash">—</span>)}
							</td>
							<td>
								<span class="mem-tickets" data-has={m.openTickets > 0 ? "true" : undefined}>
									{m.ticketsLabel}
								</span>
							</td>
							<td>
								<span class="mem-joined">{m.joinedLabel}</span>
							</td>
							{showActions && <td class="mem-col--actions">{props.renderActions?.(m) ?? null}</td>}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
