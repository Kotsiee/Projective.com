import type { JSX } from "preact";

// #region Copy
/** One row of the comparison: what it compares, the old way, and the way it works on Projective. */
export interface WhyRow {
	/** The row's label, in the section-header register. */
	label: string;
	/** The old way — a way of working, never a named company (claims Z1–Z5, "Model"). */
	old: string;
	/** Projective's way — every sentence a shipped claim (§5). */
	ours: string;
}

/**
 * "Why it's different" (`flows/LANDING.md` §4.2), verbatim. The comparison is of working models,
 * not companies: no competitor figure has a sourced, dated citation (Decision #281 (C)). The
 * subtitle is the glossary's one allowed place for "team-as-a-service" (Decision #283 (C)).
 */
export const WHY_COPY = {
	eyebrow: "Why it's different",
	/** `[A1]` */
	title: "One team, not five strangers.",
	subtitle: "Team-as-a-service, made simple.",
	/** The two columns' headers, and each cell's cue when the rows stack below `--bp-md`. */
	oldWay: "The old way",
	ours: "With Projective",
	rows: [
		{
			label: "Who you hire",
			/** `[Z1]` */
			old: "Five freelancers, hired one by one.",
			/** `[A4]` */
			ours: "One ready-made team. They apply, work and get paid together.",
		},
		{
			label: "How it's priced",
			/** `[Z2]` */
			old: "Open-ended hourly billing.",
			/** `[B7]` */
			ours: "A fixed price per stage, agreed before work starts.",
		},
		{
			label: "When money moves",
			/** `[Z3]` */
			old: "Pay up front for the whole job.",
			/** `[A2]` `[B2]` */
			ours: "Pay one stage at a time. The team is paid when you approve it.",
		},
		{
			label: "Keeping track",
			/** `[Z4]` */
			old: "Chase updates across email and chat.",
			/** `[K1]` */
			ours: "See every task on one board, from New to Completed.",
		},
		{
			label: "Team pay",
			/** `[Z5]` */
			old: "Work out who gets what by hand.",
			/** `[N1]` */
			ours: "Team pay splits automatically into each agreed share.",
		},
	] satisfies readonly WhyRow[],
} as const;

/** The section's anchor. */
export const WHY_SECTION_ID = "why-different";

/** The h2's id: the section and its table are labelled by it. */
export const WHY_TITLE_ID = "why-different-title";
// #endregion

// #region Component
/**
 * WhyDifferent — "Why it's different", `#why-different` (`flows/LANDING.md` §2.1 note 8, §2.2 note 6,
 * §2.3 note 6, §4.2): the section header, the h2 and its subtitle, then the old way and Projective
 * compared as a table of plain text on the page's one neutral tonal step (`--lp-step-bg`, a solid
 * region tone between the hero and How it works) — a row label, the old way in the quieter ink,
 * Projective's way in the stronger one, one hairline between rows and the Projective column marked
 * only by its header's teal rule (`lp-sections.css`). Nothing is boxed and nothing moves.
 *
 * A real `<table>` (column headers, row headers), with its roles stated so it still reads as a table
 * below `--bp-md`, where the rows stack and each way carries its own cue — hidden from assistive
 * technology, which has the column header. A server component with no island.
 */
export function WhyDifferent(): JSX.Element {
	return (
		<section
			id={WHY_SECTION_ID}
			class="lp-section lp-section--step lp-why"
			aria-labelledby={WHY_TITLE_ID}
		>
			<div class="lp-section__inner">
				<header class="lp-section__head">
					<p class="lp-eyebrow">{WHY_COPY.eyebrow}</p>
					<h2
						id={WHY_TITLE_ID}
						class="lp-display lp-display--section lp-section__title lp-why__title"
					>
						{WHY_COPY.title}
					</h2>
					<p class="lp-lead lp-section__lead">{WHY_COPY.subtitle}</p>
				</header>
				<table class="lp-why__table" role="table" aria-labelledby={WHY_TITLE_ID}>
					<thead class="lp-why__thead" role="rowgroup">
						<tr role="row">
							<td class="lp-why__corner" role="cell" />
							<th class="lp-eyebrow lp-why__col lp-why__col--old" scope="col" role="columnheader">
								{WHY_COPY.oldWay}
							</th>
							<th class="lp-eyebrow lp-why__col lp-why__col--ours" scope="col" role="columnheader">
								{WHY_COPY.ours}
							</th>
						</tr>
					</thead>
					<tbody role="rowgroup">
						{WHY_COPY.rows.map((row) => (
							<tr key={row.label} class="lp-why__row" role="row">
								<th class="lp-eyebrow lp-why__label" scope="row" role="rowheader">{row.label}</th>
								<td class="lp-why__way lp-why__way--old" role="cell">
									<span class="lp-meta lp-why__cue" aria-hidden="true">{WHY_COPY.oldWay}</span>
									<span class="lp-why__text">{row.old}</span>
								</td>
								<td class="lp-why__way lp-why__way--ours" role="cell">
									<span class="lp-meta lp-why__cue" aria-hidden="true">{WHY_COPY.ours}</span>
									<span class="lp-why__text">{row.ours}</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

export default WhyDifferent;
// #endregion
