import { Fragment, type JSX } from "preact";
import { useMemo } from "preact/hooks";
import { type DataColumn, DataTable, MetaLine, MoneyView, Tag } from "@projective/ui/display";
import {
	roleLabel,
	roleRank,
	type WorkspaceKind,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import {
	lifecycleTag,
	type RosterColumn,
	rosterColumns,
	rosterSpent,
	spentSortValue,
	statusSortValue,
} from "../core/roster-model.ts";
import { EntityStateMarks, type WorkspaceCardAction, workspaceMenu } from "./WorkspaceCard.tsx";
import { EntityMark } from "./EntityMark.tsx";

/**
 * WorkspaceTable — the roster's list presentation, for somebody who belongs to a dozen entities and
 * wants to scan them rather than look at them: a `DataTable` preset (Decision #224 — the Table,
 * #228 (G)) over the columns `roster-model.ts` names for the kind — Name · Your role · Members · Live
 * projects · Status · Updated, and for a business Spent (30d) before Status (BU1). Counts and money sit
 * right-aligned in tabular figures; every column sorts (the role by authority, the status by lifecycle
 * order, not the alphabet); the Status cell holds a `Tag` only for a Draft or Archived entity;
 * selection is none — a row opens its console, and carries the card's own menu (`workspaceMenu`) on a
 * kebab and on right-click, so the two presentations can never offer different actions for the same
 * entity. The row the session acts as says "Acting" in its role cell.
 *
 * Spent (30d) draws the server's figures, one `MoneyView` per currency PINNED to that currency (the
 * FinanceSummary precedent), so a figure reads exactly as it was spent whatever currency the viewer
 * browses in — no conversion, no total, no period delta. Several currencies are MetaLine's markup
 * (`ui-meta-line`, middot separators) built here because MetaLine takes text only, as the business
 * Finance head's balance line does.
 *
 * Dumb: no fetching, no permission decisions, no arithmetic.
 */

// #region Props
/** Props for {@link WorkspaceTable}. */
export interface WorkspaceTableProps {
	/** Which kind's columns to draw — a business adds Spent (30d). */
	kind: WorkspaceKind;
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
 * The `DataTable` descriptor for one of the roster's columns. Its hide priority is the contract's
 * (`rosterColumns`): the least essential column leaves a narrowing table first, and Name and Status
 * never do.
 */
function columnFor(column: RosterColumn): DataColumn<WorkspaceSummary> {
	const base = {
		id: column.id,
		header: column.header,
		align: column.align,
		priority: column.priority,
	};
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
				value: (row) => row.memberCount,
			};
		case "projects":
			return {
				...base,
				type: "number",
				format: "integer",
				width: 128,
				value: (row) => row.activeProjects,
			};
		case "spent":
			return {
				...base,
				type: "custom",
				width: 176,
				// Most spent first on the first press — the reader sorting money wants the biggest.
				firstSortDir: "desc",
				render: (row) => <SpentCell summary={row} />,
				sortValue: spentSortValue,
			};
		case "status":
			return {
				...base,
				type: "custom",
				width: 120,
				render: (row) => <StatusCell summary={row} />,
				sortValue: (row) => statusSortValue(row.status),
			};
		case "updated":
			return {
				...base,
				type: "date",
				format: "date",
				width: 128,
				firstSortDir: "desc",
				value: (row) => row.updatedAt,
			};
	}
}
// #endregion

// #region Table
/** The roster's list presentation — a `DataTable` over the kind's columns (`rosterColumns`). */
export function WorkspaceTable(props: WorkspaceTableProps): JSX.Element {
	const { kind, items, hrefFor, busy = false, label, onAction } = props;
	const columns = useMemo(() => rosterColumns(kind).map(columnFor), [kind]);

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

/**
 * What a business spent in 30 days: one figure, or several on one meta line, each in its own currency
 * and never converted (`displayCurrency` pinned to the figure's own). `null` when nothing moved, so
 * the table draws its own empty mark.
 */
function SpentCell({ summary }: { summary: WorkspaceSummary }): JSX.Element | null {
	const spent = rosterSpent(summary);
	if (!spent) return null;
	if (spent.length === 1) {
		const [figure] = spent;
		return <MoneyView value={figure} displayCurrency={figure.currency} size="micro" hideOrigin />;
	}
	return (
		<span class="ui-meta-line ui-meta-line--xs">
			{spent.map((figure, i) => (
				<Fragment key={figure.currency}>
					{i > 0 && <span class="ui-meta-line__sep" aria-hidden="true">·</span>}
					<span class="ui-meta-line__item">
						<MoneyView
							value={figure}
							displayCurrency={figure.currency}
							size="micro"
							hideOrigin
						/>
					</span>
				</Fragment>
			))}
		</span>
	);
}

/** The lifecycle `Tag` — only for a Draft or Archived entity; an active row's cell stays empty. */
function StatusCell({ summary }: { summary: WorkspaceSummary }): JSX.Element | null {
	const tag = lifecycleTag(summary.status);
	return tag ? <Tag value={tag.label} severity={tag.severity} variant="subtle" rounded /> : null;
}
// #endregion
