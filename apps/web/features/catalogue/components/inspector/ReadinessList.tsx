import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { ListingDetail, PublishReadiness } from "../../types/catalogue-types.ts";
import { readinessItems } from "../../core/readiness-items.ts";

/**
 * ReadinessList — what publishing needs, as unboxed rows: a check for each requirement met, an open
 * ring for each still missing, and the words saying which. Never colour alone: the glyph and the
 * hidden "Done" / "To do" carry the state.
 */
export function ReadinessList(
	props: {
		listing: Pick<ListingDetail, "kind" | "serviceType">;
		readiness: PublishReadiness;
		idBase: string;
	},
): JSX.Element {
	const items = readinessItems(props.listing, props.readiness);
	const headingId = `cat-ws-ready-${props.idBase}-h`;
	return (
		<section class="cat-ws-ready" aria-labelledby={headingId}>
			<h2 class="cat-ws-ready__title" id={headingId}>
				{props.readiness.ready ? "Ready to publish" : "Before you publish"}
			</h2>
			<ul class="cat-ws-ready__list">
				{items.map((item) => (
					<li
						class="cat-ws-ready__item"
						key={item.label}
						data-done={item.done ? "true" : undefined}
					>
						<Icon name={item.done ? "check" : "circle"} size="sm" />
						<span class="ui-visually-hidden">{item.done ? "Done: " : "To do: "}</span>
						<span class="cat-ws-ready__label">{item.label}</span>
					</li>
				))}
			</ul>
		</section>
	);
}
