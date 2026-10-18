import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { type DataColumn, DataTable, MetaLine, Tag } from "@projective/ui/display";
import { roleLabel, roleRank, type WorkspaceSummary } from "@projective/types/workspace";
import {
	lifecycleTag,
	ROSTER_COLUMNS,
	type RosterColumn,
	statusSortValue,
} from "../core/roster-model.ts";
import { EntityStateMarks, type WorkspaceCardAction, workspaceMenu } from "./WorkspaceCard.tsx";
import { EntityMark } from "./EntityMark.tsx";

/**
 * WorkspaceTable — the roster's list presentation, for somebody who belongs to a dozen entities and
 * wants to scan them rather than look at them: a `DataTable` preset (Decision #224 — the Table,
 * #228 (G)) over the columns `roster-model.ts` names — Name · Your role · Members · Live projects ·
 * Status · Updated. Counts sit right-aligned in tabular figures; every column sorts (the role by
 * authority, the status by lifecycle order, not the alphabet); the Status cell holds a `Tag` only for
 * a Draft or Archived entity; selection is none — a row opens its console, and carries the card's own
 * menu (`workspaceMenu`) on a kebab and on right-click, so the two presentations can never offer
 * different actions for the same entity. The row the session acts as says "Acting" in its role cell.
 *
 * Dumb: no fetching, no permission decisions, no arithmetic.
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
/** The `DataTable` descriptor for one of the roster's columns. */
function columnFor(column: RosterColumn): DataColumn<WorkspaceSummary> {
	const base = { id: column.id, header: column.header, align: column.align };
	switch (column.id) {
		case "name":
			return {
				...base,
				type: "custom",
				fill: true,
				minWidth: 224,
				pinned: true,
				render: (row) => <IdentityCell summary={row} />,
				sortValue: (row) => row.name.toLocaleLowerCase("en-GB"),
				searchText: (row) => `${row.name} @${row.handle}`,
			};
		case "role":
			return {
				...base,
				type: "custom",
				width: 168,
				priority: 3,
				// Authority order — owner first on the first press — never the alphabet, which would
				// present admin · lead · member · owner as a ranking.
				firstSortDir: "desc",
				render: (row) => (
					<MetaLine
						as="span"
						class="wsp-rtable__role"
						items={[roleLabel(row.role), row.isActing && "Acting"]}
					/>
				),
				sortValue: (row) => roleRank(row.role),
			};
		case "members":
			return {
				...base,
				type: "number",
				format: "integer",
				width: 112,
				priority: 1,
				value: (row) => row.memberCount,
			};
		case "projects":
			return {
				...base,
				type: "number",
				format: "integer",
				width: 128,
				priority: 2,
				value: (row) => row.activeProjects,
			};
		case "status":
			return {
				...base,
				type: "custom",
				width: 120,
				priority: 4,
				render: (row) => <StatusCell summary={row} />,
				sortValue: (row) => statusSortValue(row.status),
			};
		case "updated":
			return {
				...base,
				type: "date",
				format: "date",
				width: 128,
				priority: 5,
				firstSortDir: "desc",
				value: (row) => row.updatedAt,
			};
	}
}
// #endregion

// #region Table
export function WorkspaceTable(props: WorkspaceTableProps): JSX.Element {
	const { items, hrefFor, busy = false, label, onAction } = props;
	const columns = useMemo(() => ROSTER_COLUMNS.map(columnFor), []);

	return (
		<DataTable
			class="wsp-rtable"
			rows={items}
			rowKey={(row) => row.id}
			rowLabel={(row) => row.name}
			columns={columns}
			aria-label={label}
			selectionMode="none"
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
/**
 * Mark, name and the `@handle` beneath it, then the unseen-activity pulse and — while verification is
 * outstanding — its state dot, each with its words in a Tooltip (§B.6).
 */
function IdentityCell({ summary }: { summary: WorkspaceSummary }): JSX.Element {
	return (
		<span class="wsp-rtable__ident" data-kind={summary.kind}>
			<EntityMark
				name={summary.name}
				handle={summary.handle}
				image={summary.avatar}
				size="sm"
			/>
			<span class="wsp-rtable__name">
				<span class="wsp-rtable__name-text">{summary.name}</span>
				<span class="wsp-rtable__sub">@{summary.handle}</span>
			</span>
			<EntityStateMarks summary={summary} />
		</span>
	);
}

/** The lifecycle `Tag` — only for a Draft or Archived entity; an active row's cell stays empty. */
function StatusCell({ summary }: { summary: WorkspaceSummary }): JSX.Element | null {
	const tag = lifecycleTag(summary.status);
	return tag ? <Tag value={tag.label} severity={tag.severity} variant="subtle" rounded /> : null;
}
// #endregion
