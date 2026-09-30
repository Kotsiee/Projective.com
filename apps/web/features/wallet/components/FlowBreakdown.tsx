import type { JSX } from "preact";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type { ActivityView } from "../types/wallet-types.ts";
import { categoryLabel, type FlowPeriod, periodPhrase } from "../core/wallet-model.ts";
import { CategoryIcon } from "./wallet-glyphs.tsx";

/** Props for {@link FlowBreakdown}. */
export interface FlowBreakdownProps {
	period: FlowPeriod;
	activity: ActivityView | null;
	loading: boolean;
}

/** A share in basis points as the whole percent a reader compares, with `<1%` for a sliver. */
function percentOf(shareBp: number): string {
	if (shareBp <= 0) return "0%";
	if (shareBp < 100) return "<1%";
	return `${Math.round(shareBp / 100)}%`;
}

/**
 * Where the window's money went: the server's per-category totals with each one's share of the whole,
 * then the projects that moved the most. Every figure and share is the server's — the bars are only
 * the share drawn as a width, one hue, so a category is read by its label and glyph and never by colour.
 */
export function FlowBreakdown(props: FlowBreakdownProps): JSX.Element | null {
	const a = props.activity;
	if (!a) return null;
	const phrase = periodPhrase(props.period);
	return (
		<>
			<section
				class="wlt-section wlt-breakdown"
				aria-labelledby="wlt-bycat-title"
				aria-busy={props.loading ? "true" : "false"}
			>
				<header class="wlt-section__head">
					<h2 id="wlt-bycat-title" class="wlt-section__title">By category</h2>
				</header>
				{a.byCategory.length > 0
					? (
						<ul class="wlt-breakdown__list">
							{a.byCategory.map((slice) => (
								<li key={slice.category} class="wlt-breakdown__row">
									<span
										class="wlt-breakdown__mark"
										data-category={slice.category}
										aria-hidden="true"
									>
										<CategoryIcon category={slice.category} size="sm" />
									</span>
									<span class="wlt-breakdown__label">{categoryLabel(slice.category)}</span>
									<span class="wlt-breakdown__share">{percentOf(slice.shareBp)}</span>
									<MoneyView
										value={slice.amount}
										size="body"
										hideOrigin
										class="wlt-breakdown__amount"
									/>
									<span class="wlt-breakdown__track" aria-hidden="true">
										<span
											class="wlt-breakdown__fill"
											style={styleVars({ "--share": Math.min(1, slice.shareBp / 10000) })}
										/>
									</span>
								</li>
							))}
						</ul>
					)
					: <p class="wlt-empty">Nothing moved over {phrase}.</p>}
			</section>

			<section class="wlt-section wlt-breakdown" aria-labelledby="wlt-byproj-title">
				<header class="wlt-section__head">
					<h2 id="wlt-byproj-title" class="wlt-section__title">By project</h2>
				</header>
				{a.byProject.length > 0
					? (
						<ul class="wlt-breakdown__list">
							{a.byProject.map((project) => (
								<li key={project.id} class="wlt-breakdown__row wlt-breakdown__row--plain">
									<span class="wlt-breakdown__label">{project.name}</span>
									<MoneyView
										value={project.amount}
										size="body"
										hideOrigin
										class="wlt-breakdown__amount"
									/>
								</li>
							))}
						</ul>
					)
					: <p class="wlt-empty">No project money moved over {phrase}.</p>}
			</section>
		</>
	);
}
