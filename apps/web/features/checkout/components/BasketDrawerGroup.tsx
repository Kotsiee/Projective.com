import type { ComponentChildren, JSX } from "preact";
import { Amount } from "./Amount.tsx";
import type { MoneyView } from "../types/checkout-types.ts";

/** Props for {@link BasketDrawerGroup}. */
export interface BasketDrawerGroupProps {
	/** Stable id the heading's `id` derives from. */
	id: string;
	icon: JSX.Element;
	label: string;
	/** A Meta-register second line under the label. */
	caption?: string | null;
	/** The server's group subtotal, printed verbatim; omitted for a shelf that is not being paid for. */
	total?: MoneyView | null;
	/** The saved-for-later shelf, which reads at a lower temperature. */
	saved?: boolean;
	/** The group's `BasketDrawerRow`s. */
	children: ComponentChildren;
}

/**
 * BasketDrawerGroup — one group of the basket drawer: a heading of glyph, label, Meta-register caption
 * and the server's subtotal, over its lines. No box around it (§B.9): the heading's type register and
 * the lines' single hairlines are the only separation.
 */
export function BasketDrawerGroup(props: BasketDrawerGroupProps): JSX.Element {
	const headingId = `bskd-g-${props.id}`;
	return (
		<section
			class={props.saved ? "bskd__group bskd__group--saved" : "bskd__group"}
			aria-labelledby={headingId}
		>
			<h3 class="bskd__group-head" id={headingId}>
				<span class="bskd__group-icon" aria-hidden="true">{props.icon}</span>
				<span class="bskd__group-text">
					<span class="bskd__group-label">{props.label}</span>
					{props.caption ? <span class="bskd__group-caption">{props.caption}</span> : null}
				</span>
				{props.total ? <Amount class="bskd__group-total" value={props.total} hideOrigin /> : null}
			</h3>
			<ul class="bskd__lines">{props.children}</ul>
		</section>
	);
}
