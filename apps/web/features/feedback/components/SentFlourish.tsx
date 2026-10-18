import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { motionReduced } from "@features/explore/core/view-transition.ts";

/**
 * SentFlourish — the owner's small "whoosh" when an idea is sent (Decision #272 (flair)): a paper
 * aeroplane (the registry's `send` glyph — "sent", the concept it already names) lifts off the
 * success mark and flies out of view, once.
 *
 * Pure decoration, `aria-hidden`: the success is announced by the form's polite live region, which
 * does not depend on this at all. It moves transform and opacity only, on token durations and a
 * non-overshooting curve, and it is not rendered under either reduced-motion channel — read from the
 * document after mount (the server never renders it), with the stylesheet's `display: none` as a
 * second lock.
 */
export function SentFlourish(): JSX.Element | null {
	const fly = useSignal(false);
	useEffect(() => {
		if (!motionReduced()) fly.value = true;
	}, []);
	if (!fly.value) return null;
	return (
		<span class="fb-flight" aria-hidden="true" onAnimationEnd={() => (fly.value = false)}>
			<Icon name="send" />
		</span>
	);
}
