import type { JSX } from "preact";
import type { Testimonial } from "@projective/types/explore";
import { Avatar } from "@projective/ui/display";

/**
 * Testimonials — a continuously moving marquee of alternating client & freelancer success stories.
 * Two rows drift in opposite directions for depth; the track is duplicated so the loop is seamless
 * (pure CSS animation, no JS measurement). Pauses on hover/focus; reduced-motion freezes it into a
 * static, scrollable strip. Zero client JS.
 *
 * Every quote is a REAL review — its own words, its own author, the author's own headline as the role
 * line. The section renders nothing until at least three exist: a marquee of one or two quotes loops
 * the same sentence past the reader and reads as padding rather than proof.
 */

/** Below this many quotes the marquee would visibly repeat itself, so the section stays hidden. */
const MIN_QUOTES = 3;

function Row({ items, reverse }: { items: Testimonial[]; reverse?: boolean }): JSX.Element {
	// Duplicate the sequence so the -50% keyframe wraps seamlessly.
	const loop = [...items, ...items];
	return (
		<div class={`lp-quotes__row${reverse ? " lp-quotes__row--rev" : ""}`}>
			<div class="lp-quotes__track">
				{loop.map((q, i) => (
					<figure
						class={`lp-quote lp-quote--${q.voice}`}
						key={`${q.id}:${i}`}
						aria-hidden={i >= items.length}
					>
						<span class="lp-quote__tag">{q.voice === "client" ? "Customer" : "Helper"}</span>
						<blockquote class="lp-quote__text">{q.quote}</blockquote>
						<figcaption class="lp-quote__who">
							<Avatar
								image={q.author.avatar}
								placeholder={q.author.avatarPlaceholder}
								label={q.author.name}
								alt=""
								size="md"
							/>
							<span class="lp-quote__id">
								<span class="lp-quote__name">{q.author.name}</span>
								{q.role && <span class="lp-quote__role">{q.role}</span>}
							</span>
						</figcaption>
					</figure>
				))}
			</div>
		</div>
	);
}

export function Testimonials({ quotes }: { quotes: Testimonial[] }): JSX.Element | null {
	if (quotes.length < MIN_QUOTES) return null;
	return (
		<section class="lp-section lp-quotes" aria-labelledby="lp-quotes-title">
			<div class="lp-section__container">
				<header class="lp-section__head">
					<div class="lp-section__headmain">
						<span class="lp-eyebrow">Loved by both sides</span>
						<h2 class="lp-section__title" id="lp-quotes-title">
							<span class="lp-section__title-thin">Happy stories from</span>
							<span class="lp-section__title-strong">customers & helpers</span>
						</h2>
					</div>
				</header>
			</div>
			<div class="lp-quotes__marquee">
				<Row items={quotes} />
				<Row items={[...quotes].reverse()} reverse />
			</div>
		</section>
	);
}
