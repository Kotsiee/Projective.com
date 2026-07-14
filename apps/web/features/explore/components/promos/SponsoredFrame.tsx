import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { vars } from "@features/marketing/core/style.ts";
import type { SponsoredSlot } from "../../types/explore-types.ts";

/**
 * SponsoredFrame — a deliberately-reserved promoted content frame. Clearly labelled "Promoted" (Tag)
 * so it is never mistaken for organic discovery, with a media panel, owner attribution, and a single
 * CTA. The whole frame is the route action (anchor), so its four-sided treatment is legitimate.
 */
export function SponsoredFrame({ slot }: { slot: SponsoredSlot }): JSX.Element {
	return (
		<a
			class="ex-sponsored"
			href={slot.href}
			style={vars({ "--ex-cover": `url("${slot.media}")` })}
			aria-label={`Promoted: ${slot.title}`}
		>
			<div class="ex-sponsored__media" aria-hidden="true" />
			<div class="ex-sponsored__body">
				<span class="ex-sponsored__promoted">{slot.eyebrow}</span>
				<h3 class="ex-sponsored__title">{slot.title}</h3>
				<p class="ex-sponsored__text">{slot.body}</p>
				<div class="ex-sponsored__foot">
					<span class="ex-owner ex-owner--sm">
						<Avatar image={slot.owner.avatar} alt="" size="sm" class="ex-owner__avatar" />
						<span class="ex-owner__name">{slot.owner.name}</span>
					</span>
					<span class="ex-cta">{slot.cta} →</span>
				</div>
			</div>
		</a>
	);
}
