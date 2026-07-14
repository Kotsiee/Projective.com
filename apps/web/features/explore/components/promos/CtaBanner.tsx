import type { JSX } from "preact";
import type { CtaBanner as CtaBannerModel } from "../../types/explore-types.ts";

/**
 * CtaBanner — a crisp conversion banner ("Become a Freelancer" / "Launch a Team"). Two tones map to
 * token surfaces (primary tint vs neutral). The whole banner's action is a single anchor button; the
 * frame itself is a tonal panel (no four-sided border on the non-interactive container).
 */
export function CtaBanner({ banner }: { banner: CtaBannerModel }): JSX.Element {
	return (
		<section class={`ex-cta-banner ex-cta-banner--${banner.tone}`} aria-label={banner.title}>
			<div class="ex-cta-banner__text">
				<span class="ex-eyebrow">{banner.eyebrow}</span>
				<h3 class="ex-cta-banner__title">{banner.title}</h3>
				<p class="ex-cta-banner__body">{banner.body}</p>
			</div>
			<a class="ex-btn ex-btn--solid" href={banner.href}>{banner.cta}</a>
		</section>
	);
}
