import type { JSX } from "preact";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { heroCtas, type HeroViewer } from "@features/landing/core/hero-search.ts";
import { money, price } from "@features/landing/core/demos/payments-model.ts";
import {
	approvedStageLine,
	evenSplitOf,
	TEAM_PAY_COPY,
	TEAM_PAY_FIXTURE,
	teamPayFrames,
	type TeamPayRow,
	type TeamPayView,
	teamPayView,
} from "@features/landing/core/demos/split-model.ts";
import type { SectionPoint } from "@features/landing/components/PaymentProtection.tsx";

// #region Copy
/**
 * "For freelancers and teams" (`flows/LANDING.md` §4.8), verbatim. Who owns the finished work is
 * said the claims table's way (`[P1]`: stated up front and written into the project's rules), never
 * "your work stays yours" (§5.1); the paid split rules are labelled Coming soon (`[N8]`).
 */
export const FOR_TEAMS_COPY = {
	eyebrow: "For freelancers and teams",
	/** `[A4]` */
	title: "Earn together. Get paid together.",
	/** `[A7]` */
	subline: "Join a team or start one. Apply for work as one unit.",
	points: [
		{
			title: "Pay that splits itself",
			/** `[N1]` */
			body:
				"When a stage is approved, the team's payment splits automatically into each member's agreed share.",
		},
		{
			title: "See each share first",
			/** `[N6]` */
			body: "Whoever manages the team's money sees each person's share before a payment lands.",
		},
		{
			title: "Every penny adds up",
			/** `[N4]` */
			body: "Splits add up to the penny. Any leftover penny stays in the team vault.",
		},
		{
			title: "Clears in 7 days",
			/** `[E1]` `[E2]` */
			body: "Each member's share clears in 7 days. Then they can withdraw it to their bank.",
		},
		{
			title: "Workload limits",
			/** `[O1]` */
			body:
				"The board won't let anyone claim a task that would push them past their workload limit.",
		},
		{
			title: "Agree who owns the work",
			/** `[P1]` */
			body:
				"Every project states up front who owns the finished work: a full transfer, a licence, shared ownership or Projective's partner terms. It's written into the project's rules.",
		},
		{
			title: "Free to split",
			/** `[N7]` `[N8]` */
			body:
				"Split evenly or set custom shares, free on every team. Coming soon with Pro Team: a finder's fee, or paying everything into the team vault.",
		},
		{
			title: "Verified by Stripe",
			/** `[H5]` */
			body: "Verify with a photo ID, a quick selfie and your bank details.",
		},
	] satisfies readonly SectionPoint[],
	/** `[Q2]` */
	smallPrint: "Buying, selling and joining teams unlock at 18.",
	findProjects: "Find open projects",
} as const;

/** The section's anchor. */
export const FOR_TEAMS_SECTION_ID = "for-freelancers";

/** The h2's id: the section is labelled by it. */
export const FOR_TEAMS_TITLE_ID = "for-freelancers-title";
// #endregion

// #region Calls to action
/** One call to action of the section. */
export interface TeamsCta {
	label: string;
	href: string;
}

/**
 * The section's calls to action (`flows/LANDING.md` §4.8): "Offer your skills" by the hero's
 * per-viewer mapping ({@link heroCtas}, §4.1) as the region's one fill, then "Find open projects"
 * (`explorePath('projects')`) as a text link. The mapping already sends a freelancer to open
 * projects ("Find work"), so that viewer gets the one link rather than two to the same page; a
 * 13–17 account, whom the mapping offers nothing, gets the link alone.
 */
export function teamsCtas(viewer: HeroViewer): { offer: TeamsCta | null; projects: TeamsCta } {
	const projects = { label: FOR_TEAMS_COPY.findProjects, href: explorePath("projects") };
	const { offer } = heroCtas(viewer);
	return { offer: offer && offer.href !== projects.href ? offer : null, projects };
}
// #endregion

// #region The figure
/** A row's tone on the figure: its place among the members (the first three), or the vault's. */
export type TeamsTone = "1" | "2" | "3" | "vault";

const MEMBER_TONES = ["1", "2", "3"] as const;

/** One row of the figure, with the tone its swatch and its bar segment share. */
export interface TeamsRow {
	row: TeamPayRow;
	tone: TeamsTone;
}

/** The figure's rows in the example's order: each member's share, then the team vault's. */
export function teamsRows(view: TeamPayView): TeamsRow[] {
	return [
		...view.members.map((row, index) => ({
			row,
			tone: MEMBER_TONES[Math.min(index, MEMBER_TONES.length - 1)],
		})),
		{ row: view.vault, tone: "vault" },
	];
}

/** One segment of the figure's bar: where it starts and how wide it is, in percent of the bar. */
export interface TeamsBarSegment {
	key: string;
	tone: TeamsTone;
	x: number;
	width: number;
}

/** The gap between two segments of the bar, in percent of its width. */
const BAR_GAP = 0.6;

/** A bar coordinate to three places, so the server's markup is stable. */
function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * The bar's segments: each member's share, then the vault's, each as wide as its part of what the
 * team receives, with a hairline gap between them. Empty while the amounts are unknown.
 */
export function teamsBar(view: TeamPayView): TeamsBarSegment[] {
	const rows = teamsRows(view);
	const total = view.payoutMinor ?? 0;
	if (total <= 0 || rows.some(({ row }) => row.amountMinor === null)) return [];
	const room = 100 - BAR_GAP * (rows.length - 1);
	let x = 0;
	return rows.map(({ row, tone }) => {
		const width = ((row.amountMinor ?? 0) / total) * room;
		const segment = { key: row.key, tone, x: round(x), width: round(width) };
		x += width + BAR_GAP;
		return segment;
	});
}

/**
 * The figure's words, in the Team pay example's own order (§4.4 frames 1, 2 and 4, verbatim): the
 * approved stage after the fee (`[C4]`), the vault's 10% taken first (`[N2]`) — so every member's
 * amount below is a share of what is left — and the spare penny the vault keeps (`[N4]`), which is
 * why the vault's row is a penny above its 10%.
 */
export function teamsFigureLines(feeBp: number): { approved: string; vault: string; dust: string } {
	const frames = teamPayFrames(feeBp);
	const line = (phase: string) => frames.find((frame) => frame.phase === phase)?.lines[0] ?? "";
	return { approved: approvedStageLine(feeBp), vault: line("vault"), dust: line("dust") };
}

/** Props for {@link TeamsFigure}. */
interface TeamsFigureProps {
	view: TeamPayView;
	feeBp: number;
}

/**
 * The section's figure (`flows/LANDING.md` §2.1 note 20, §2.2 note 20, §2.3 note 19): one still of
 * the Team pay example (`core/demos/split-model.ts`, `fn_team_split_plan` mirrored), never
 * animated — its caption "Example · a £2,000 stage", the approved stage after the fee and the
 * vault's cut ({@link teamsFigureLines}), the bar (a picture of the rows, hidden from assistive
 * technology, each segment as wide as its amount), the rows to the penny — amounts only, as the
 * wireframes draw them, so nothing prints two bases of percentage — and the spare-penny line. An
 * exhibit on the canvas under one rule, never boxed. Drawn only when the fee is known (§4: V5's
 * amounts hide without it).
 */
function TeamsFigure({ view, feeBp }: TeamsFigureProps): JSX.Element {
	const segments = teamsBar(view);
	const currency = TEAM_PAY_FIXTURE.currency;
	const lines = teamsFigureLines(feeBp);
	return (
		<figure class="lp-section__figure lp-teams__figure" aria-labelledby="for-freelancers-example">
			<figcaption id="for-freelancers-example" class="lp-eyebrow">
				{`Example · a ${price(view.stageMinor, currency)} stage`}
			</figcaption>
			<div class="lp-teams__lines">
				<p class="lp-teams__lead">{lines.approved}</p>
				<p class="lp-teams__lead">{lines.vault}</p>
			</div>
			{segments.length > 0
				? (
					<svg class="lp-teams__bar" aria-hidden="true">
						{segments.map((segment) => (
							<rect
								key={segment.key}
								class="lp-teams__seg"
								data-tone={segment.tone}
								x={`${segment.x}%`}
								y="0"
								width={`${segment.width}%`}
								height="100%"
								rx="2"
							/>
						))}
					</svg>
				)
				: null}
			<table class="lp-teams__rows">
				<caption class="ui-visually-hidden">{TEAM_PAY_COPY.splitGroup}</caption>
				<tbody>
					{teamsRows(view).map(({ row, tone }) => (
						<tr key={row.key}>
							<th class="lp-teams__role" scope="row">
								<span class="lp-teams__swatch" data-tone={tone} aria-hidden="true" />
								{row.role}
							</th>
							<td class="lp-teams__amount">
								{row.amountMinor === null ? null : money(row.amountMinor, currency)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p class="lp-meta">{lines.dust}</p>
		</figure>
	);
}
// #endregion

// #region Component
/** Props for {@link ForTeams}. */
export interface ForTeamsProps {
	/** Who is looking: picks "Offer your skills"' label and target (§4.1's mapping). */
	viewer: HeroViewer;
	/**
	 * The platform fee in basis points from the server (`PublicMetricsService` `platformFeeBp`).
	 * Absent or `null`, the team-pay figure — whose every amount is after the fee — is not drawn
	 * (`flows/LANDING.md` §4) and the head takes the whole row. Never hard-coded.
	 */
	feeBp?: number | null;
}

/**
 * ForTeams — the freelancers' section, `#for-freelancers` (`flows/LANDING.md` §2.1 notes 19–20,
 * §2.2 note 20, §2.3 note 19, §4.8), on the canvas in the precision voice. It leads with its
 * figure: the section header, the h2 and its subline, with the team-pay figure
 * ({@link TeamsFigure}) beside them from `--bp-lg`; then the eight points as a dense grid of plain
 * text (an h3 and its body on one hairline each: two across from `--bp-md`, four from 1280px) —
 * a different shape from Payment protection's ledger beside its rail (Decision #301 (D)); then the
 * small print and the calls to action ({@link teamsCtas}): one tier-2 fill, never amber — nothing
 * here moves money (§B.8.1). Static, like every section after the hero (§2.7). A server component
 * with no island.
 */
export function ForTeams({ viewer, feeBp = null }: ForTeamsProps): JSX.Element {
	const figure = feeBp === null ? null : { view: teamPayView(evenSplitOf(), feeBp), feeBp };
	const { offer, projects } = teamsCtas(viewer);
	return (
		<section
			id={FOR_TEAMS_SECTION_ID}
			class="lp-section lp-teams"
			aria-labelledby={FOR_TEAMS_TITLE_ID}
		>
			<div class="lp-section__inner">
				<div class={`lp-teams__top${figure ? "" : " lp-teams__top--text"}`}>
					<header class="lp-section__head lp-teams__head">
						<p class="lp-eyebrow">{FOR_TEAMS_COPY.eyebrow}</p>
						<h2
							id={FOR_TEAMS_TITLE_ID}
							class="lp-display lp-display--section lp-section__title lp-teams__title"
						>
							{FOR_TEAMS_COPY.title}
						</h2>
						<p class="lp-lead lp-section__lead">{FOR_TEAMS_COPY.subline}</p>
					</header>
					{figure ? <TeamsFigure view={figure.view} feeBp={figure.feeBp} /> : null}
				</div>
				<ul class="lp-section__points lp-teams__points">
					{FOR_TEAMS_COPY.points.map((point) => (
						<li key={point.title} class="lp-section__point">
							<h3 class="lp-heading">{point.title}</h3>
							<p class="lp-body lp-section__point-body">{point.body}</p>
						</li>
					))}
				</ul>
				<div class="lp-teams__foot">
					<p class="lp-meta">{FOR_TEAMS_COPY.smallPrint}</p>
					<div class="lp-teams__ctas">
						{offer
							? (
								<a class="lp-btn lp-btn--structural lp-teams__cta" href={offer.href}>
									{offer.label}
								</a>
							)
							: null}
						<a class="lp-section__link" href={projects.href}>{projects.label}</a>
					</div>
				</div>
			</div>
		</section>
	);
}

export default ForTeams;
// #endregion
