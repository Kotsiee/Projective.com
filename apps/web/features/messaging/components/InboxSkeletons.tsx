import type { JSX } from "preact";
import { Skeleton } from "@projective/ui/feedback";

/**
 * InboxSkeletons — the loading placeholders for the two `/messages` list surfaces: the body inbox
 * ({@link InboxListSkeleton}) and the navigation lane ({@link ConversationListSkeleton}).
 *
 * Every block here is the shared `@projective/ui/feedback` {@link Skeleton}; this module contributes
 * only the row COMPOSITION and the announcement. Geometry is declared in `inbox.css` against the same
 * tokens the real rows resolve — a placeholder reserves the exact block size of the row it stands in
 * for, so the list holds its height when the real conversations replace it.
 *
 * `Skeleton` is `aria-hidden`, which is right for a decorative block and leaves the surface silent on
 * its own. {@link InboxLoadingStatus} is the announcement half, and both islands render it
 * UNCONDITIONALLY: a live region has to be in the accessibility tree BEFORE its text changes, so one
 * mounted with its message already set is routinely never announced at all.
 */

// #region Row count
const MIN_ROWS = 3;
const MAX_ROWS = 8;
const DEFAULT_ROWS = 6;

/**
 * How many placeholder rows to draw, given how many real rows are on screen at the moment the
 * placeholder takes over.
 *
 * The count is a SIZING input and never a gating one — it mirrors the outgoing list so the swap costs
 * no height, and falls back to a readable default when there is nothing to mirror. Whether a skeleton
 * shows at all is a question about the fetch lifecycle, which emptiness cannot answer.
 */
export function skeletonRowCount(visible: number): number {
	if (visible <= 0) return DEFAULT_ROWS;
	return Math.min(MAX_ROWS, Math.max(MIN_ROWS, visible));
}
// #endregion

// #region Announcement
export interface InboxLoadingStatusProps {
	/** Whether the placeholder is on screen. */
	busy: boolean;
	/** What is loading — announced verbatim, so it names the surface, not the mechanism. */
	label: string;
}

/**
 * The spoken half of a skeleton: a permanently-mounted polite live region that carries the loading
 * message while the placeholder is up and is empty otherwise.
 *
 * It is tied to the placeholder rather than to the raw in-flight flag on purpose. A request that
 * resolves inside the delay threshold shows a sighted viewer nothing, and announcing it anyway would
 * make a debounced search chatter on every keystroke — both audiences get told the same thing.
 */
export function InboxLoadingStatus(props: InboxLoadingStatusProps): JSX.Element {
	return (
		<p class="ui-visually-hidden" role="status">
			{props.busy ? props.label : ""}
		</p>
	);
}
// #endregion

// #region Body list
export interface InboxListSkeletonProps {
	/** Placeholder rows to draw — see {@link skeletonRowCount}. */
	rows?: number;
}

/**
 * The `/messages` BODY placeholder — one row per {@link InboxRow}: a 2.5rem avatar beside the
 * identity and preview lines, on the row's own padding and column gap.
 */
export function InboxListSkeleton({ rows = DEFAULT_ROWS }: InboxListSkeletonProps): JSX.Element {
	return (
		<div class="inbox__skeleton" aria-hidden="true">
			{Array.from({ length: rows }, (_, i) => (
				<div class="inbox__skel-row" key={i}>
					<Skeleton shape="circle" class="inbox__skel-avatar" />
					<span class="inbox__skel-lines">
						<Skeleton shape="text" class="inbox__skel-line inbox__skel-line--name" />
						<Skeleton shape="text" class="inbox__skel-line inbox__skel-line--preview" />
					</span>
				</div>
			))}
		</div>
	);
}
// #endregion

// #region Lane list
export interface ConversationListSkeletonProps {
	/** Placeholder rows to draw — see {@link skeletonRowCount}. */
	rows?: number;
}

/**
 * The lane placeholder — one row per {@link ConversationRow}.
 *
 * The lane row is text-led rather than avatar-led: its stacked name and preview run taller than the
 * 2.5rem avatar beside them, so each placeholder line reserves the real line box and centres a
 * thinner bar inside it (`inbox.css`). Sizing the bars alone would leave every row short.
 */
export function ConversationListSkeleton(
	{ rows = DEFAULT_ROWS }: ConversationListSkeletonProps,
): JSX.Element {
	return (
		<div class="inbox-skel" aria-hidden="true">
			{Array.from({ length: rows }, (_, i) => (
				<div class="inbox-skel__row" key={i}>
					<Skeleton shape="circle" class="inbox-skel__avatar" />
					<span class="inbox-skel__body">
						<span class="inbox-skel__line inbox-skel__line--name">
							<Skeleton shape="text" class="inbox-skel__bar inbox-skel__bar--name" />
						</span>
						<span class="inbox-skel__line inbox-skel__line--preview">
							<Skeleton shape="text" class="inbox-skel__bar inbox-skel__bar--preview" />
						</span>
					</span>
				</div>
			))}
		</div>
	);
}
// #endregion
