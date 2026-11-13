import type { JSX } from "preact";
import { Skeleton } from "@projective/ui/feedback";

const GROUPS = [2, 1] as const;

function Bar({ class: className, width }: { class: string; width?: string }): JSX.Element {
	return (
		<span class={`${className} bskd-ph__line`}>
			<Skeleton shape="text" animation="shimmer" width={width} />
		</span>
	);
}

/**
 * BasketDrawerSkeleton — the drawer's placeholder while a basket is read or a list is switched to.
 * Every block sits in the real row's own box — the group heading's label and caption lines, the
 * line's thumbnail, title, price, seller and action cells — so each placeholder is exactly the height
 * of what replaces it, filled with `shimmer` `Skeleton`s. The blocks are decorative; one visually
 * hidden status names the wait.
 */
export function BasketDrawerSkeleton(): JSX.Element {
	return (
		<div class="bskd__skeleton">
			<p class="ui-visually-hidden" role="status">Loading your basket…</p>
			{GROUPS.map((lines, g) => (
				<div key={g} class="bskd__group" aria-hidden="true">
					<div class="bskd__group-head">
						<span class="bskd__group-icon">
							<Skeleton shape="circle" animation="shimmer" class="bskd-ph__icon" />
						</span>
						<span class="bskd__group-text">
							<Bar class="bskd__group-label" width="45%" />
							<Bar class="bskd__group-caption" width="30%" />
						</span>
						<Bar class="bskd__group-total bskd-ph__figure" />
					</div>
					<ul class="bskd__lines">
						{Array.from(
							{ length: lines },
							(_, i) => (
								<li key={i} class="bskd-line bskd-line--placeholder">
									<span class="bskd-line__check">
										<Skeleton shape="rect" animation="shimmer" class="bskd-ph__check" />
									</span>
									<span class="bskd-line__link">
										<Skeleton shape="rect" animation="shimmer" class="bskd-line__thumb" />
										<span class="bskd-line__body">
											<Bar class="bskd-line__title" width="70%" />
											<Bar class="bskd-line__meta" width="40%" />
										</span>
									</span>
									<span class="bskd-line__prices">
										<Bar class="bskd-line__price bskd-ph__figure" />
									</span>
									<span class="bskd-line__sub">
										<Bar class="bskd-line__seller" width="35%" />
									</span>
									<span class="bskd-line__actions">
										<Skeleton shape="circle" animation="shimmer" class="bskd-ph__action" />
										<Skeleton shape="circle" animation="shimmer" class="bskd-ph__action" />
									</span>
								</li>
							),
						)}
					</ul>
				</div>
			))}
		</div>
	);
}
