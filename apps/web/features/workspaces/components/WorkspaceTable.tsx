import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { type DataColumn, DataTable } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { kindCopy, roleLabel, type WorkspaceSummary } from "@projective/types/workspace";
import { initialsOf } from "../core/workspace-model.ts";
import { type WorkspaceCardAction, workspaceMenu } from "./WorkspaceCard.tsx";

/**
 * WorkspaceTable — the roster's compact view, for somebody who belongs to a dozen entities and wants to
 * scan them rather than look at them, as a `DataTable` preset: identity · your role · members · the
 * kind's headline figure · state. Each row opens the entity's console, and carries the card's own menu
 * (`workspaceMenu`) on a kebab and on right-click, so the two presentations can never offer different
 * actions for the same entity.
 *
 * Dumb: no fetching, no permission decisions, no arithmetic. `stats[0]` is a server-formatted string
 * (root CLAUDE.md §12) and is rendered verbatim.
 */

// #region Props
export interface WorkspaceTableProps {
	/** The filtered, ordered rows to show. */
	items: WorkspaceSummary[];
	/** Resolves each row's console href. */
	hrefFor: (summary: WorkspaceSummary) => string;
	/** Whether a context switch is in flight, so the acting action cannot be double-fired. */
	busy?: boolean;
	/** Accessible name for the grid. */
	label: string;
	/** Dispatches a menu action upward; the island owns every side effect. */
	onAction: (action: WorkspaceCardAction, summary: WorkspaceSummary) => void;
}
// #endregion

// #region Columns
/**
 * The money column's header, taken from the rows themselves rather than hard-coded per kind.
 *
 * The server chose the stat labels for this kind ("Earned 30d" · "Spent 30d"), so reading one back is
 * the only way the column heading cannot disagree with the figures under it.
 */
function headerFor(items: readonly WorkspaceSummary[]): string {
	for (const item of items) {
		const label = item.stats[2]?.label ?? item.stats[0]?.label;
		if (label) return label;
	}
	return "Activity";
}

function columnsFor(moneyHeader: string): DataColumn<WorkspaceSummary>[] {
	return [
		{
			id: "name",
			header: "Name",
			type: "custom",
			fill: true,
			minWidth: 224,
			pinned: true,
			render: (row) => <IdentityCell summary={row} />,
			sortValue: (row) => row.name,
			searchText: (row) => `${row.name} @${row.handle}`,
		},
		{
			// Not sortable: a role is a word, and ordering admin · lead · member · owner alphabetically
			// would present a wrong order as authority.
			id: "role",
			header: "Your role",
			type: "custom",
			width: 168,
			priority: 2,
			render: (row) => <RoleCell summary={row} />,
		},
		{
			id: "members",
			header: "Members",
			type: "number",
			width: 112,
			priority: 1,
			value: (row) => row.memberCount,
		},
		{
			// The kind's headline figure — earnings for a team, spend for a business — already formatted.
			id: "stats",
			header: moneyHeader,
			type: "text",
			sortKey: null,
			align: "end",
			width: 136,
			priority: 3,
			value: (row) => row.stats[2]?.value ?? row.stats[0]?.value ?? null,
		},
		{
			id: "status",
			header: "State",
			type: "custom",
			width: 104,
			render: (row) => <StateCell summary={row} />,
			sortValue: (row) => row.status,
		},
	];
}
// #endregion

// #region Table
export function WorkspaceTable(props: WorkspaceTableProps): JSX.Element {
	const { items, hrefFor, busy = false, label, onAction } = props;
	const moneyHeader = headerFor(items);
	const columns = useMemo(() => columnsFor(moneyHeader), [moneyHeader]);

	return (
		<DataTable
			class="wsp-rtable"
			rows={items}
			rowKey={(row) => row.id}
			rowLabel={(row) => row.name}
			columns={columns}
			aria-label={label}
			multiSort={false}
			rowHref={hrefFor}
			rowActions={(row) => workspaceMenu(row, hrefFor(row), busy, onAction)}
			rowState={(row) => (row.isActing ? "acting" : null)}
			rowHeight={60}
			virtualize={false}
			columnChooser={false}
		/>
	);
}
// #endregion

// #region Cells
/** Mark, name, the handle beneath it, and the new-activity pulse. */
function IdentityCell({ summary }: { summary: WorkspaceSummary }): JSX.Element {
	return (
		<span class="wsp-rtable__ident" data-kind={summary.kind}>
			<span class="wsp-mark wsp-mark--sm" aria-hidden="true">
				{summary.avatar
					? <img class="wsp-mark__img" src={summary.avatar} alt="" loading="lazy" />
					: <span class="wsp-mark__initial">{initialsOf(summary.name, summary.handle)}</span>}
			</span>
			<span class="wsp-rtable__name">
				<span class="wsp-rtable__name-text">{summary.name}</span>
				<span class="wsp-rtable__sub">@{summary.handle}</span>
			</span>
			{summary.hasUpdate && (
				<Tooltip content="New activity since you last looked" placement="top">
					<span class="wsp-pulse" role="status" aria-label="New activity" />
				</Tooltip>
			)}
		</span>
	);
}

/** The viewer's role, and the quiet acting chip (the row already carries the acting tonal step). */
function RoleCell({ summary }: { summary: WorkspaceSummary }): JSX.Element {
	return (
		<>
			<span class="wsp-chip" data-tone={summary.isOwner ? undefined : "muted"}>
				{roleLabel(summary.role)}
			</span>
			{summary.isActing && (
				<span class="wsp-actingchip wsp-actingchip--quiet">
					<span class="wsp-actingchip__dot" aria-hidden="true" />
					Acting
				</span>
			)}
		</>
	);
}

/**
 * Lifecycle and verification as dots. Verified draws nothing — a badge on every healthy row trains the
 * reader to ignore it, and then it cannot work on the row that is genuinely blocked (§B.6).
 */
function StateCell({ summary }: { summary: WorkspaceSummary }): JSX.Element {
	const copy = kindCopy(summary.kind);
	const lifecycle = summary.status === "draft"
		? "Draft — usable now, setup unfinished"
		: summary.status === "archived"
		? "Archived — restorable at any time"
		: `Active ${copy.noun}`;

	return (
		<>
			<Tooltip content={lifecycle} placement="top">
				<span
					class="wsp-statedot"
					data-state={summary.status}
					role="img"
					aria-label={lifecycle}
				/>
			</Tooltip>
			{summary.verification !== "verified" && (
				<Tooltip
					content={summary.verification === "pending"
						? `${copy.verification} in review`
						: `${copy.verification} not started — needed before money moves`}
					placement="top"
				>
					<span
						class="wsp-statedot"
						data-verify={summary.verification}
						role="img"
						aria-label={`${copy.verification} ${summary.verification}`}
					/>
				</Tooltip>
			)}
		</>
	);
}
// #endregion
