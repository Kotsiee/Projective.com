import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "@features/explore/styles/explore.css";
import { ServiceCard } from "@features/explore/components/cards/ServiceCard.tsx";
import { ProductCard } from "@features/explore/components/cards/ProductCard.tsx";
import type { ProductItem, ServiceItem } from "@projective/types/explore";

const FOCUSABLE = "a, button, input, select, textarea, [tabindex]";

const noop = () => {};

/**
 * LiveCardPreview — the listing as a buyer meets it in search: the REAL `ServiceCard` /
 * `ProductCard` (explore's own stylesheet), fed by the same `listingCardItem` adapter discovery
 * uses, so it changes on every keystroke and cannot drift from the feed. It is a picture, not a
 * control: the card is `aria-hidden` and inert, every link and button in it leaves the tab order,
 * selecting it does nothing, and a visually hidden sentence says what it shows.
 */
export function LiveCardPreview(
	props: { item: ServiceItem | ProductItem; idBase: string },
): JSX.Element {
	const frame = useRef<HTMLDivElement>(null);
	const { item } = props;
	const descriptionId = `cat-ws-card-${props.idBase}-desc`;

	useEffect(() => {
		frame.current?.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
			el.tabIndex = -1;
		});
	});

	return (
		<figure class="cat-ws-card" aria-describedby={descriptionId}>
			<figcaption class="cat-ws-card__caption">Live card</figcaption>
			<p class="ui-visually-hidden" id={descriptionId}>
				How “{item.title}” appears to buyers in search. It updates as you edit.
			</p>
			<div class="cat-ws-card__frame" ref={frame} aria-hidden="true" inert>
				{item.type === "services"
					? <ServiceCard item={item} onSelect={noop} authed />
					: <ProductCard item={item} onSelect={noop} authed />}
			</div>
		</figure>
	);
}
