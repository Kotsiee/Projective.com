import type { ComponentChildren, JSX } from "preact";
import {
	type Rail,
	WAYS,
	WAYS_COPY,
	WAYS_SECTION_ID,
	WAYS_TITLE_ID,
	type WayToWork,
} from "@features/landing/core/rails.ts";
import { LandingRail } from "@features/landing/components/LandingRail.tsx";

// #region Schematics
/** The session timeline's hour marks, each on a whole pixel's centre. */
const HOUR_TICKS = [0.5, 20.5, 40.5, 60.5, 80.5, 100.5, 119.5] as const;

/**
 * A way's small schematic, decorative: one stroke tone and one ink. A single job is one bar in
 * three milestones, the first paid for as it starts; an ongoing workflow is tasks across three
 * stages, each paid for as it is picked up; a live session is one booked slot on a timeline.
 */
function WayMark({ id }: { id: WayToWork["id"] }): JSX.Element {
	return (
		<svg
			class="lp-ways__mark"
			viewBox="0 8 120 32"
			width="120"
			height="32"
			aria-hidden="true"
			focusable="false"
		>
			{id === "job"
				? (
					<>
						<rect class="lp-ways__mark-paid" x="0" y="20" width="36" height="8" rx="4" />
						<rect class="lp-ways__mark-line" x="42.5" y="20.5" width="35" height="7" rx="3.5" />
						<rect class="lp-ways__mark-line" x="84.5" y="20.5" width="35" height="7" rx="3.5" />
					</>
				)
				: id === "workflow"
				? (
					<>
						<line class="lp-ways__mark-faint" x1="40.5" y1="10" x2="40.5" y2="38" />
						<line class="lp-ways__mark-faint" x1="80.5" y1="10" x2="80.5" y2="38" />
						<rect class="lp-ways__mark-paid" x="6" y="18" width="12" height="12" rx="3" />
						<rect class="lp-ways__mark-paid" x="22" y="18" width="12" height="12" rx="3" />
						<rect class="lp-ways__mark-paid" x="46" y="18" width="12" height="12" rx="3" />
						<rect class="lp-ways__mark-line" x="62.5" y="18.5" width="11" height="11" rx="2.5" />
						<rect class="lp-ways__mark-line" x="86.5" y="18.5" width="11" height="11" rx="2.5" />
						<rect class="lp-ways__mark-line" x="102.5" y="18.5" width="11" height="11" rx="2.5" />
					</>
				)
				: (
					<>
						<line class="lp-ways__mark-faint" x1="0" y1="36.5" x2="120" y2="36.5" />
						{HOUR_TICKS.map((x) => (
							<line key={x} class="lp-ways__mark-line" x1={x} y1="32" x2={x} y2="36.5" />
						))}
						<rect class="lp-ways__mark-paid" x="42" y="16" width="36" height="10" rx="3" />
					</>
				)}
		</svg>
	);
}
// #endregion

// #region Ways
/**
 * One way to work: a column of text, never a card (#288, DESIGN_SYSTEM §B.4) — its schematic, the
 * title, what it is, when the money moves (one register quieter) and its one link, at the foot.
 */
function WayColumn({ way }: { way: WayToWork }): JSX.Element {
	return (
		<li class="lp-ways__choice" data-way={way.id}>
			<WayMark id={way.id} />
			<h3 class="lp-heading lp-ways__choice-title">{way.title}</h3>
			<p class="lp-body lp-ways__body">{way.body}</p>
			<p class="lp-body lp-body--sm lp-ways__money">{way.money}</p>
			<p class="lp-ways__go">
				<a class="lp-ways__link" href={way.href}>{way.label}</a>
			</p>
		</li>
	);
}
// #endregion

// #region Section
/** Props for {@link WaysToWorkView}. */
export interface WaysToWorkViewProps {
	/** The live rails ({@link Rail}), already sliced and bounded on the server; may be empty. */
	rails: readonly Rail[];
	/** The section's client half (the RailScroll island), placed inside the section. */
	children?: ComponentChildren;
}

/**
 * WaysToWorkView — "Ways to work", `#ways-to-work` (`flows/LANDING.md` §4.5, §2.1 notes 14–15), as
 * the server renders it: the section header, the h2 and the subline; the three ways as columns of
 * text, each with its one link (Post a single job · Browse ongoing work · Browse live sessions); the
 * small print; then the live rails, each its own {@link LandingRail}, and nothing at all for the
 * rails when there are none (no empty state). Static on the canvas: no reveal, no autoplay (§2.7).
 */
export function WaysToWorkView({ rails, children }: WaysToWorkViewProps): JSX.Element {
	return (
		<section id={WAYS_SECTION_ID} class="lp-ways" aria-labelledby={WAYS_TITLE_ID}>
			<div class="lp-ways__inner">
				<header class="lp-ways__head">
					<p class="lp-eyebrow">{WAYS_COPY.eyebrow}</p>
					<h2 id={WAYS_TITLE_ID} class="lp-display lp-display--section lp-ways__title">
						{WAYS_COPY.title}
					</h2>
					<p class="lp-lead lp-ways__lead">{WAYS_COPY.subline}</p>
				</header>
				<ul class="lp-ways__choices">
					{WAYS.map((way) => <WayColumn key={way.id} way={way} />)}
				</ul>
				<p class="lp-body lp-body--sm lp-ways__note">{WAYS_COPY.note}</p>
				{rails.length > 0
					? (
						<div class="lp-rails">
							{rails.map((rail) => <LandingRail key={rail.id} rail={rail} />)}
						</div>
					)
					: null}
				{children}
			</div>
		</section>
	);
}
// #endregion
