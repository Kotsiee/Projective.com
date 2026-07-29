import type { JSX } from "preact";
import { FundStateMark } from "./FundStateMark.tsx";
import { Money } from "./Money.tsx";
import { EmptyBand } from "./band-parts.tsx";
import type { IncomingItem } from "../types/wallet-types.ts";

/**
 * IncomingTimeline — money on the way.
 *
 * The one place on the surface where TIME is the organising fact rather than amount. A pending
 * release shows its progress through the 7-day clearing window as a ring drawn at the SERVER's
 * elapsed fraction — the client never measures elapsed time, because an unsynced clock would draw a
 * confidently wrong countdown about someone's money.
 *
 * Rows are separated by one hairline each and never boxed.
 */
export interface IncomingTimelineProps {
	items: IncomingItem[];
	/** How many to show before the list stops. Band 4 shows four. */
	limit?: number;
}

export function IncomingTimeline(props: IncomingTimelineProps): JSX.Element {
	const items = props.items.slice(0, props.limit ?? 4);
	if (items.length === 0) {
		return (
			<EmptyBand text="Nothing on the way." hint="Funded escrow and clearing releases land here." />
		);
	}

	return (
		<ul class="wlt-incoming" role="list">
			{items.map((item) => {
				const body = (
					<>
						<span class="wlt-incoming__glyph">
							<FundStateMark state={item.state} clearingFraction={item.clearingFraction} />
						</span>
						<span class="wlt-incoming__body">
							<span class="wlt-incoming__label">{item.label}</span>
							<span class="wlt-incoming__clearing">{item.clearingLabel}</span>
						</span>
						<span class="wlt-incoming__amount">
							<Money value={item.amount} size="body" />
						</span>
					</>
				);
				return (
					<li class="wlt-incoming__item" key={item.id} data-state={item.state}>
						{item.href
							? <a class="wlt-incoming__link" href={item.href}>{body}</a>
							: <div class="wlt-incoming__link">{body}</div>}
					</li>
				);
			})}
		</ul>
	);
}
