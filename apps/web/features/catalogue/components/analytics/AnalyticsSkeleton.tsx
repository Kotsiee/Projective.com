import type { JSX } from "preact";
import { Skeleton } from "@projective/ui/feedback";

/**
 * AnalyticsSkeleton — the canvas while a read is in flight: the tile row and the chart regions as
 * placeholders of their real size, so nothing jumps when the figures land. It never shows a figure,
 * zero included.
 */
export function AnalyticsSkeleton({ regions }: { regions: number }): JSX.Element {
	return (
		<div class="cat-an__skeleton" aria-hidden="true">
			<div class="cat-an__skeleton-tiles">
				{[0, 1, 2, 3].map((i) => (
					<div key={i} class="cat-an__skeleton-tile">
						<Skeleton shape="text" width="40%" />
						<Skeleton shape="text" width="70%" height="var(--text-3xl)" />
					</div>
				))}
			</div>
			{Array.from({ length: regions }, (_, i) => (
				<div key={i} class="cat-an__skeleton-region">
					<Skeleton shape="text" width="12rem" />
					<Skeleton shape="rect" class="cat-an__skeleton-plot" />
				</div>
			))}
		</div>
	);
}
