import type { JSX } from "preact";
import type { PublicMetrics } from "@projective/types/marketing";
import { ABOUT_METRICS_COPY } from "../core/about-content.ts";
import { aboutMetricTiles, formatAsOf, withheldNotice } from "../core/metric-format.ts";

/** Props for {@link AboutMetrics}. */
export interface AboutMetricsProps {
	/** The live figures, or `null` when the read failed (the section then says so, and shows none). */
	metrics: PublicMetrics | null;
	/** The section heading's id (the region is named by it). */
	headingId: string;
}

/**
 * AboutMetrics — the live metrics row of `/about` (Decision #277): one unboxed tile per published
 * figure — a section-caps label, the figure at the display register in `tabular-nums`, one meta
 * sentence and a mono "as of" timestamp — separated by spacing and one hairline per boundary. A
 * figure below the threshold has no tile, and one sentence names what is withheld and why; nothing is
 * padded. Server-rendered from the service's answer, no client fetch. Server-safe (no stylesheet
 * import): the page's sheet arrives with the walkthrough island.
 */
export function AboutMetrics({ metrics, headingId }: AboutMetricsProps): JSX.Element {
	const asOf = metrics ? formatAsOf(metrics.asOf) : "";
	const tiles = metrics ? aboutMetricTiles(metrics) : [];
	const notice = metrics ? withheldNotice(metrics) : null;

	return (
		<div class="abt-metrics">
			<div class="abt-metrics__head">
				<h2 class="abt__label" id={headingId}>{ABOUT_METRICS_COPY.label}</h2>
				{metrics && <p class="abt__meta">{ABOUT_METRICS_COPY.cadence}</p>}
			</div>

			{metrics
				? (
					<ul class="abt-metrics__row" aria-labelledby={headingId}>
						{tiles.map((tile) => (
							<li class="abt-metric" key={tile.key} data-metric={tile.key}>
								<p class="abt-metric__label" id={`abt-metric-${tile.key}`}>{tile.label}</p>
								<p class="abt-metric__value">
									{tile.value.spoken
										? (
											<>
												<span aria-hidden="true">{tile.value.text}</span>
												<span class="ui-visually-hidden">{tile.value.spoken}</span>
											</>
										)
										: tile.value.text}
								</p>
								<p class="abt-metric__caption">{tile.caption}</p>
								<p class="abt-metric__asof">
									As of <time dateTime={metrics.asOf}>{asOf}</time>
								</p>
							</li>
						))}
					</ul>
				)
				: <p class="abt-metrics__note">{ABOUT_METRICS_COPY.unavailable}</p>}

			{notice && <p class="abt-metrics__note">{notice}</p>}
		</div>
	);
}
