import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Button, SelectButton } from "@projective/ui/fields";
import { HintPopover } from "@projective/ui/feedback";
import { PROMOTION_SURFACE_LABEL, PromotionSurfaceSchema } from "@projective/types/catalogue";
import {
	endPromotion,
	loadPromotion,
	promotionBusy,
	promotionError,
	promotionState,
	promotionSurface,
	startPromotion,
	watchPromotionSim,
} from "../../core/promotion-store.ts";
import { promotionEndLabel, promotionPlanName } from "../../core/promotion-model.ts";

const SURFACE_OPTIONS = PromotionSurfaceSchema.options.map((value) => ({
	value,
	label: PROMOTION_SURFACE_LABEL[value],
}));

/**
 * PromotionPanel — the listing workspace's Promote control (Decision #454): the seller's one
 * plan-allocated flight, started on a chosen surface or stopped, with the reason it cannot start when
 * it cannot. Unboxed rows under the publish checklist; the only control rendered is one that acts.
 */
export function PromotionPanel(props: { slug: string; idBase: string }): JSX.Element {
	useEffect(() => {
		void loadPromotion(props.slug);
	}, [props.slug]);
	useEffect(() => watchPromotionSim(), []);

	const headingId = `cat-ws-promo-${props.idBase}-h`;
	const state = promotionState.value;
	const busy = promotionBusy.value;
	const error = promotionError.value;

	return (
		<section class="cat-ws-promo" aria-labelledby={headingId} aria-busy={busy || undefined}>
			<div class="cat-ws-promo__head">
				<h2 class="cat-ws-promo__title" id={headingId}>Promotion</h2>
				<HintPopover label="About promotion">
					A promotion places this listing in its own slot labelled “Promoted” on Explore. It never
					changes where the listing ranks in results, and it is never shown to under-18s. You run
					one promotion at a time.
				</HintPopover>
			</div>

			{state === null && !error && <p class="cat-ws-promo__text">Checking your plan…</p>}

			{state?.kind === "unpublished" && (
				<p class="cat-ws-promo__text">Publish this listing to promote it.</p>
			)}

			{state?.kind === "not_entitled" && (
				<p class="cat-ws-promo__text">
					Promotion comes with {promotionPlanName(state.subject)}.
				</p>
			)}

			{state?.kind === "elsewhere" && (
				<p class="cat-ws-promo__text">
					Your promotion is running on {state.elsewhere.slug
						? <a href={`/catalogue/${state.elsewhere.slug}`}>{state.elsewhere.title}</a>
						: state.elsewhere.title} until {promotionEndLabel(state.elsewhere.endsAt)}.
				</p>
			)}

			{state?.kind === "live" && (
				<>
					<p class="cat-ws-promo__text">
						Promoted on {PROMOTION_SURFACE_LABEL[state.live.surface]} until{" "}
						<span class="cat-ws-promo__figure">{promotionEndLabel(state.live.endsAt)}</span>.
					</p>
					<Button
						label="Stop promotion"
						severity="neutral"
						variant="outlined"
						size="sm"
						aria-busy={busy}
						onClick={() => void endPromotion(props.slug)}
					/>
				</>
			)}

			{state?.kind === "available" && (
				<>
					<SelectButton
						options={SURFACE_OPTIONS}
						value={promotionSurface.value}
						onValueChange={(v) => {
							const parsed = PromotionSurfaceSchema.safeParse(v);
							if (parsed.success) promotionSurface.value = parsed.data;
						}}
						aria-label="Where to promote"
					/>
					<p class="cat-ws-promo__text">
						Runs for {state.flightDays} days, included with your plan.
					</p>
					<Button
						label="Promote"
						size="sm"
						aria-busy={busy}
						onClick={() => void startPromotion(props.slug)}
					/>
				</>
			)}

			{error && <p class="cat-ws-promo__error" role="alert">{error}</p>}
		</section>
	);
}
