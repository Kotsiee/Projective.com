import type { JSX } from "preact";
import { Table, type TableColumn } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { kindCopy, roleLabel, type WorkspaceSummary } from "@projective/types/workspace";
import { initialsOf } from "../core/workspace-model.ts";
import { type WorkspaceCardAction, WorkspaceKebab } from "./WorkspaceCard.tsx";

/**
 * WorkspaceTable — the roster's compact view, for somebody who belongs to a dozen entities and wants to
 * scan them rather than look at them.
 *
 * Built on the library `Table`, which already owns everything a collection needs and this surface must
 * not re-implement: the shared column-track model that keeps header and body cells aligned, click- and
 * keyboard-sortable headers with `aria-sort`, a sticky header, and `role="table"` semantics. What the
 * feature supplies is the projection — the identity cell, the iconographic state, and the same kebab the
 * card uses, so the two presentations can never offer different actions for the same entity.
 *
 * The entity NAME is the link, not the row: the primitive's rows are `role="row"` divs and wrapping one
 * in an anchor is illegal, but a real anchor in the identity cell is better anyway — middle-click and
 * Cmd-click work, and a row-wide click target would swallow the kebab.
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

// #region Table
export function WorkspaceTable(props: WorkspaceTableProps): JSX.Element {
	const { items, hrefFor, busy, label, onAction } = props;

	const columns: TableColumn<WorkspaceSummary>[] = [
		{
			field: "name",
			header: "Name",
			sortable: true,
			width: "minmax(14rem, 3fr)",
			body: (row) => <IdentityCell summary={row} href={hrefFor(row)} />,
		},
		{
			field: "role",
			header: "Your role",
			// Deliberately NOT sortable. The primitive sorts by the raw field value, which for a role is a
			// string — so it would order admin · lead · member · owner alphabetically and present that as
			// authority. A wrong order that looks meaningful is worse than no sort on this column.
			width: "minmax(8rem, 1fr)",
			body: (row) => (
				<>
					<span class="wsp-chip" data-tone={row.isOwner ? undefined : "muted"}>
						{roleLabel(row.role)}
					</span>
					{
						/*
						 * The QUIET acting chip here, not the loud one the card carries: the row already carries
						 * the acting tonal step, and the surface allows exactly one loud channel per element.
						 */
					}
					{row.isActing && (
						<span class="wsp-actingchip wsp-actingchip--quiet">
							<span class="wsp-actingchip__dot" aria-hidden="true" />
							Acting
						</span>
					)}
				</>
			),
		},
		{
			field: "memberCount",
			header: "Members",
			sortable: true,
			align: "end",
			width: "minmax(6rem, 1fr)",
			body: (row) => <span class="wsp-num">{row.memberCount}</span>,
		},
		{
			// The kind's headline figure — earnings for a team, spend for a business — already formatted.
			field: "stats",
			header: headerFor(items),
			width: "minmax(7rem, 1fr)",
			align: "end",
			body: (row) => (
				<span class="wsp-money wsp-money--body">
					{row.stats[2]?.value ?? row.stats[0]?.value ?? "—"}
				</span>
			),
		},
		{
			field: "status",
			header: "State",
			sortable: true,
			width: "minmax(5rem, auto)",
			body: (row) => <StateCell summary={row} />,
		},
		{
			field: "id",
			header: "",
			width: "auto",
			align: "end",
			body: (row) => (
				<WorkspaceKebab
					summary={row}
					href={hrefFor(row)}
					busy={busy}
					onAction={onAction}
					placement="bottom-end"
				/>
			),
		},
	];

	return (
		<Table<WorkspaceSummary>
			class="wsp-rtable"
			value={items}
			columns={columns}
			dataKey={(row) => row.id}
			multiSort={false}
			aria-label={label}
			rowClass={(row) => row.isActing ? "wsp-rtable__acting" : undefined}
		/>
	);
}
// #endregion

// #region Cells
/** Mark, name (the link), and the handle beneath it. */
function IdentityCell(
	{ summary, href }: { summary: WorkspaceSummary; href: string },
): JSX.Element {
	return (
		<span class="wsp-rtable__ident" data-kind={summary.kind}>
			<span class="wsp-mark wsp-mark--sm" aria-hidden="true">
				{summary.avatar
					? <img class="wsp-mark__img" src={summary.avatar} alt="" loading="lazy" />
					: <span class="wsp-mark__initial">{initialsOf(summary.name, summary.handle)}</span>}
			</span>
			<span class="wsp-rtable__name">
				<a class="wsp-rtable__name-text" href={href}>{summary.name}</a>
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

// #region Helpers
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
// #endregion
