import type { JSX } from "preact";
import { Skeleton } from "@projective/ui/feedback";
import { PendingAmount } from "./OrderTotals.tsx";

function Bar(props: { class: string; width: string }): JSX.Element {
	return (
		<span class={`${props.class} bnow-ph`}>
			<Skeleton shape="text" width={props.width} height="0.75em" animation="shimmer" />
		</span>
	);
}

/** Props for {@link BuyNowInputsSkeleton}. */
export interface BuyNowInputsSkeletonProps {
	/** A ticket's purchase lists its stages above the routes. */
	stages: boolean;
}

/**
 * The Buy-now modal's left column while its quote and session are read: the stage rows (a ticket),
 * then the payment routes — the real rows' classes, so each placeholder takes the row's own geometry.
 */
export function BuyNowInputsSkeleton(props: BuyNowInputsSkeletonProps): JSX.Element {
	return (
		<div class="bnow__inputs bnow__skeleton" aria-hidden="true">
			{props.stages && (
				<section class="bnow__section">
					<h3 class="bnow__head">Stages</h3>
					<div class="stp">
						<ul class="stp__list">
							{["9rem", "7rem"].map((width) => (
								<li key={width} class="stp__row">
									<span class="stp__control">
										<Skeleton
											width="1.125rem"
											height="1.125rem"
											radius="var(--radius-xs)"
											animation="shimmer"
										/>
									</span>
									<span class="stp__body">
										<Bar class="stp__name" width={width} />
										<Bar class="stp__note" width="6rem" />
									</span>
									<span class="stp__price">
										<PendingAmount size="body" width="4rem" />
									</span>
								</li>
							))}
						</ul>
					</div>
				</section>
			)}
			<section class="bnow__section">
				<h3 class="bnow__head">How you'll pay</h3>
				<div class="cko-routes cko-routes--compact">
					{["8rem", "9rem"].map((width) => (
						<div key={width} class="cko-route">
							<div class="cko-route__head">
								<Skeleton shape="circle" width="var(--cko-route-dot)" animation="shimmer" />
								<Skeleton
									width="var(--icon-md)"
									height="var(--icon-md)"
									radius="var(--radius-xs)"
									animation="shimmer"
								/>
								<span class="cko-route__text">
									<Bar class="cko-route__name" width={width} />
									<Bar class="cko-route__sub" width="5rem" />
								</span>
							</div>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

/** Props for {@link OrderLinesSkeleton}. */
export interface OrderLinesSkeletonProps {
	/** How many lines are being read. */
	count: number;
}

/** Order lines while they are (re)read: the summary's own row geometry, one shimmer row per line. */
export function OrderLinesSkeleton(props: OrderLinesSkeletonProps): JSX.Element {
	return (
		<ul class="cko-rail__items bnow__skeleton" aria-hidden="true">
			{Array.from(
				{ length: Math.max(1, props.count) },
				(_, row) => (
					<li key={row} class="cko-rail__item">
						<span class="cko-rail__thumb">
							<Skeleton width="100%" height="100%" radius="var(--radius-sm)" animation="shimmer" />
						</span>
						<span class="cko-rail__itembody">
							<Bar class="cko-rail__itemtitle" width="70%" />
							<Bar class="cko-rail__slotlabel" width="45%" />
						</span>
						<span class="cko-rail__linetotal">
							<PendingAmount size="body" width="3.5rem" />
						</span>
					</li>
				),
			)}
		</ul>
	);
}

/** The order's arithmetic before its first read: the totals rows at their own geometry. */
export function OrderTotalsSkeleton(): JSX.Element {
	return (
		<div class="cko-rail__totals bnow__skeleton" aria-hidden="true">
			<dl class="cko-rail__rows">
				<div class="cko-rail__row">
					<dt class="cko-rail__label">Items</dt>
					<dd class="cko-rail__value">
						<PendingAmount size="body" width="4rem" />
					</dd>
				</div>
				<div class="cko-rail__row">
					<dt class="cko-rail__label">
						Platform service fee
						<Bar class="cko-rail__note" width="10rem" />
					</dt>
					<dd class="cko-rail__value">
						<PendingAmount size="body" width="3.5rem" />
					</dd>
				</div>
			</dl>
			<p class="cko-rail__grand">
				<span class="cko-rail__grand-label">Order Total</span>
				<span class="cko-rail__grand-figure">
					<PendingAmount size="hero" width="7rem" />
				</span>
			</p>
		</div>
	);
}
