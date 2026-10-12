import type { JSX } from "preact";
import { Skeleton } from "@projective/ui/feedback";

/** One placeholder in the media card's anatomy: a 16:10 frame, a creator line, a title, a foot. */
export function CardSkeleton(): JSX.Element {
	return (
		<div class="ex-skel" aria-hidden="true">
			<Skeleton class="ex-skel__media" animation="shimmer" radius="var(--card-radius)" />
			<div class="ex-skel__body">
				<Skeleton shape="text" width="45%" animation="shimmer" />
				<Skeleton shape="text" lines={2} animation="shimmer" />
				<div class="ex-skel__foot">
					<Skeleton shape="text" width="30%" animation="shimmer" />
					<Skeleton shape="text" width="22%" animation="shimmer" />
				</div>
			</div>
		</div>
	);
}

/**
 * A grid of {@link CardSkeleton}s standing in for a result set while it refreshes. Announces the
 * wait once through a polite status; the placeholders themselves are hidden from assistive tech.
 */
export function CardSkeletonGrid(
	{ count = 8, label = "Loading results" }: { count?: number; label?: string },
): JSX.Element {
	return (
		<div class="ex-skelgrid" aria-busy="true">
			<span class="ui-visually-hidden" role="status">{label}</span>
			{Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
		</div>
	);
}
