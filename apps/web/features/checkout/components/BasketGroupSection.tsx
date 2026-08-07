import type { ComponentChildren, JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { groupIconName } from "./checkout-glyphs.tsx";
import type { RenderGroup } from "../core/basket-view.ts";

/**
 * BasketGroupSection — one server-computed category of a basket, drawn as a section.
 *
 * The grouping itself is never this component's decision: {@link RenderGroup} is a projection of the
 * server's `basket.groups` index, so "3D Asset Wishlist", "Project Alpha tickets" and "Consultation
 * sessions" are the resolver's headings and its order. What the section adds is the honest reporting
 * around them — the group's own server-computed subtotal, and, when the header band's search is
 * narrowing the body, a note saying how many of the group's lines are currently hidden. A section that
 * showed two of five lines under a five-line subtotal, with no explanation, would read as an
 * arithmetic error rather than a filter.
 *
 * The leftover bucket (`section.orphan`) is the one section with no subtotal, because the server
 * computed none for it and this surface never invents a figure.
 *
 * Separation is a tonal heading and one hairline (§B.4). There is no box around a section.
 */

// #region Props
/** Props for {@link BasketGroupSection}. */
export interface BasketGroupSectionProps {
	/** The projected group. */
	section: RenderGroup;
	/** The rows, already built by the body so this component stays presentation-only. */
	children: ComponentChildren;
}
// #endregion

export function BasketGroupSection(props: BasketGroupSectionProps): JSX.Element {
	const { section } = props;
	const headId = `bsk-group-${section.key}`;
	const hidden = Math.max(0, section.itemCount - section.items.length);

	return (
		<section
			class="bsk-group"
			aria-labelledby={headId}
			data-orphan={section.orphan ? "true" : undefined}
		>
			<header class="bsk-group__head">
				<span class="bsk-group__icon" aria-hidden="true">
					<Icon name={groupIconName(section.group)} size="sm" />
				</span>

				<div class="bsk-group__heading">
					<h2 class="bsk-group__title" id={headId}>
						{section.href
							? <a class="bsk-group__link" href={section.href}>{section.label}</a>
							: section.label}
					</h2>
					{section.caption && <p class="bsk-group__caption">{section.caption}</p>}
				</div>

				{section.subtotal && (
					<p class="bsk-group__subtotal">
						<span class="bsk-group__subtotal-label">Selected in this group</span>
						<span class="bsk-group__subtotal-value">
							<Amount value={section.subtotal} />
						</span>
					</p>
				)}
			</header>

			{hidden > 0 && (
				<p class="bsk-group__filtered">
					Showing {section.items.length} of {section.itemCount} — the search is hiding {hidden}.
				</p>
			)}

			<ul class="bsk-group__items">{props.children}</ul>
		</section>
	);
}
