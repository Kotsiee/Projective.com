import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { SessionPlanItem } from "@projective/types/explore";
import type { CohortSitting } from "@projective/types/projects";
import SittingTime from "../islands/SittingTime.island.tsx";

/** Props for {@link SessionPlanTrack}. */
export interface SessionPlanTrackProps {
	items: readonly SessionPlanItem[];
	/** Each sitting's length in minutes, printed on a row that has no scheduled time. */
	minutes?: number;
	/** A cohort's scheduled sittings, by position: row n carries sitting n's day and time. */
	sittings?: readonly CohortSitting[];
}

/**
 * SessionPlanTrack — a fixed-count Session's or Group Session's sittings on the same continuous track
 * the Pipeline and One-Off stages use (`evp-track`, `DESIGN_SYSTEM.md` §D.8.1): a numbered node per
 * sitting, the seller's title for it, and their description as the disclosure. Native `<details>`, so
 * it stays a server component; a sitting with no description has nothing to reveal and is not a
 * disclosure. No row carries a price — the offer lives in the conversion lane (§D.7.3).
 */
export function SessionPlanTrack(
	{ items, minutes, sittings }: SessionPlanTrackProps,
): JSX.Element | null {
	if (!items.length) return null;
	return (
		<ol class="evp-track" data-count={items.length}>
			<span class="evp-track__rule" aria-hidden="true" />
			{items.map((item) => {
				const sitting = sittings?.[item.index - 1];
				const expandable = !!item.description;
				return (
					<li class="evp-track__item" key={item.index} id={`session-${item.index}`}>
						<span class="evp-track__node" aria-hidden="true">
							<span class="evp-track__ordinal">{item.index}</span>
						</span>
						<details class="evp-track__body" open>
							<summary class="evp-track__summary" role={expandable ? undefined : "presentation"}>
								<span class="evp-track__heads">
									<span class="evp-track__name">
										{item.title
											? (
												<>
													<span class="ui-visually-hidden">Session {item.index}:</span> {item.title}
												</>
											)
											: `Session ${item.index}`}
									</span>
								</span>
								{sitting
									? <SittingTime startsAt={sitting.startsAt} endsAt={sitting.endsAt} />
									: minutes
									? <span class="evp-track__meta">{minutes} min</span>
									: null}
								{expandable && (
									<Icon name="chevron-down" size="sm" class="evp-track__caret" aria-hidden />
								)}
							</summary>
							{expandable && (
								<div class="evp-track__reveal">
									<div class="evp-track__detail">
										<p class="evp-track__desc">{item.description}</p>
									</div>
								</div>
							)}
						</details>
					</li>
				);
			})}
		</ol>
	);
}
