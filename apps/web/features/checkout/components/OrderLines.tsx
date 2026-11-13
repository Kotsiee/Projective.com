import type { JSX } from "preact";
import { itemKindMeta } from "@projective/types/finance";
import { Icon } from "@projective/ui/icons";
import { itemKindLabel } from "../core/basket-model.ts";
import { Amount } from "./Amount.tsx";
import { groupIconName } from "./checkout-glyphs.tsx";
import type { BasketItem } from "../types/checkout-types.ts";

/**
 * The one detail line beneath an order line: WHICH instance of the purchasable this is — a session's
 * slot, a ticket's stage or a product's licence, else the kind's own noun. Both halves are strings the
 * server already formatted; it carries no price, because the line states its money once.
 */
function detailOf(item: BasketItem): string {
	const base = item.scheduledLabel ?? item.stageLabel ?? item.subtitle ?? itemKindLabel(item);
	const seats = item.seats !== null && item.seats > 1 ? ` · ${item.seats} seats` : "";
	return `${base}${seats}`;
}

/** Props for {@link OrderLines}. */
export interface OrderLinesProps {
	/** The lines this payment covers, in server order. */
	items: readonly BasketItem[];
	/** What is said in place of the list when it is empty. */
	empty: string;
	/** DOM id prefix for each line, so a blocker or a refusal can point at it. */
	lineIdPrefix?: string;
}

/**
 * OrderLines — the lines an order pays for, one figure each, as the checkout rail and Buy now both
 * list them. A line the server closed says why on the line itself, never in a second banner.
 */
export function OrderLines(props: OrderLinesProps): JSX.Element {
	const { items, lineIdPrefix } = props;
	if (items.length === 0) {
		return <p class="cko-rail__empty" role="status">{props.empty}</p>;
	}
	return (
		<ul class="cko-rail__items">
			{items.map((item) => (
				<li
					key={item.id}
					id={lineIdPrefix ? `${lineIdPrefix}${item.id}` : undefined}
					class="cko-rail__item"
					data-available={item.available ? undefined : "false"}
				>
					<span class="cko-rail__thumb" aria-hidden="true">
						{item.thumbnail
							? <img class="cko-rail__thumbimg" src={item.thumbnail} alt="" loading="lazy" />
							: <Icon name={groupIconName(itemKindMeta(item.itemType).group)} />}
					</span>

					<span class="cko-rail__itembody">
						<span class="cko-rail__itemtitle">{item.title}</span>
						<span class="cko-rail__itemmeta">
							<span class="cko-rail__slotlabel">{detailOf(item)}</span>
							{item.quantity > 1 && <span class="cko-rail__qty">{`× ${item.quantity}`}</span>}
						</span>
						{item.available ? null : (
							<span class="cko-rail__flag" role="status">
								<Icon name="warning" size="xs" />
								<span>{item.unavailableReason ?? "This can no longer be paid for."}</span>
							</span>
						)}
					</span>

					<span class="cko-rail__linetotal">
						<Amount
							value={item.lineTotal}
							size="body"
							hideOrigin
							tone={item.available ? "default" : "muted"}
						/>
					</span>
				</li>
			))}
		</ul>
	);
}
