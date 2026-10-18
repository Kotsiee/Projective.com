import type { JSX } from "preact";
import { type DataColumn, DataTable } from "@projective/ui/display";
import type { BenchEntry } from "@projective/types/workspace";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import {
	BENCH_KIND_LABEL,
	benchMenu,
	type BenchMenuContext,
	benchRowHref,
} from "../core/bench-model.ts";
import { EntityMark } from "./EntityMark.tsx";

/**
 * BenchTable — the Talent module's bench as a `DataTable` preset (Decision #224, one table): who the
 * business has hired · what kind of party · on how many of its projects · when they last delivered · the
 * business's own rating of them. The row is the link to the party's profile when that profile opens for
 * the viewer (an invite-only team's or a private person's row is not a link); its kebab (and
 * right-click) carries View profile · Message · Add to project from {@link benchMenu}, so there is no
 * filled control in a row and no anchor nested inside the row's own link — the `@handle` is a secondary
 * text line.
 *
 * Squares are entities, circles are people: a team leads with its `EntityMark`, a freelancer with their
 * `UserAvatar`. Dumb: no fetching and no decisions — every figure and label is the server's.
 */

// #region Props
export interface BenchTableProps {
	entries: readonly BenchEntry[];
	/** The business's name, for the grid's accessible name and the menu's refusal sentence. */
	businessName: string;
	/** What the row menu needs: the hire flag, the viewer's handle, and the Message opener. */
	menu: Omit<BenchMenuContext, "businessName">;
}
// #endregion

// #region Columns
const COLUMNS: DataColumn<BenchEntry>[] = [
	{
		id: "name",
		header: "Name",
		type: "text",
		value: (e) => e.name,
		secondary: (e) => `@${e.handle}`,
		lead: (e) =>
			e.kind === "team"
				? (
					<EntityMark
						name={e.name}
						handle={e.handle}
						kind="team"
						image={e.avatar || null}
						size="sm"
					/>
				)
				: (
					<UserAvatar
						shape="circle"
						size="sm"
						image={e.avatar || undefined}
						label={e.name}
						alt=""
					/>
				),
		fill: true,
		// Name + Last worked + the kebab must fit a phone's table (358 px at 390) without a sideways
		// scroll, and Engagements must survive the console's narrow tablet stage.
		minWidth: 160,
		pinned: true,
		searchText: (e) => `${e.name} @${e.handle}`,
	},
	{
		id: "kind",
		header: "Kind",
		type: "text",
		value: (e) => BENCH_KIND_LABEL[e.kind],
		width: 120,
		priority: 2,
	},
	{
		id: "engagements",
		header: "Engagements",
		type: "number",
		value: (e) => e.engagements,
		align: "end",
		// Wide enough for the uppercase header and its sort mark without an ellipsis.
		width: 136,
		priority: 3,
	},
	{
		// "Now" outranks every date; an undated party sorts last and draws the table's own empty dash. A
		// date is a figure: the table's `ui-dt__num` (tabular) on a machine-readable <time>, as its date
		// cells draw one.
		id: "lastWorked",
		header: "Last worked",
		type: "custom",
		render: (e) =>
			e.liveNow
				? e.lastWorkedLabel
				: e.lastWorkedAt
				? (
					<time class="ui-dt__num" dateTime={e.lastWorkedAt}>
						{e.lastWorkedLabel}
					</time>
				)
				: null,
		sortValue: (e) =>
			e.liveNow ? Number.MAX_SAFE_INTEGER : e.lastWorkedAt ? Date.parse(e.lastWorkedAt) : 0,
		firstSortDir: "desc",
		width: 136,
	},
	{
		id: "rating",
		header: "Rating",
		type: "rating",
		value: (e) => e.rating,
		width: 136,
		priority: 1,
	},
];
// #endregion

// #region Table
/** The bench grid. */
export function BenchTable(props: BenchTableProps): JSX.Element {
	const { entries, businessName, menu } = props;
	const context: BenchMenuContext = { ...menu, businessName };
	return (
		<DataTable
			rows={entries}
			rowKey={(e) => `${e.kind}:${e.handle}`}
			rowLabel={(e) => e.name}
			columns={COLUMNS}
			aria-label={`The bench of ${businessName}`}
			multiSort={false}
			rowHref={benchRowHref}
			rowActions={(e) => benchMenu(e, context)}
			rowHeight={60}
			virtualize={false}
			columnChooser={false}
		/>
	);
}
// #endregion
