import type { JSX } from "preact";
import type { NotificationInboxItem } from "@projective/types/comms";
import { Button } from "@projective/ui/fields";
import { InlineNotice, Skeleton } from "@projective/ui/feedback";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import type { NotificationFeed } from "../core/useNotificationFeed.ts";
import { NotificationRow } from "./NotificationRow.tsx";

/** Props for {@link NotificationList}. */
export interface NotificationListProps {
	feed: NotificationFeed;
	now: number;
	/** The empty state's sentence for the current filter. */
	emptyTitle: string;
	emptyDescription?: string;
	/** Whether rows can be archived (not in the Archived view). */
	archivable: boolean;
	/** Bulk selection, page only. */
	selected?: ReadonlySet<string>;
	onSelect?: (item: NotificationInboxItem, on: boolean) => void;
	/** A row was opened — the drawer closes itself after marking it read. */
	onNavigate?: () => void;
}

const FIRST_PAGE_PLACEHOLDERS = 5;
const NEXT_PAGE_PLACEHOLDERS = 2;

function PlaceholderRows({ count }: { count: number }): JSX.Element {
	return (
		<>
			{Array.from(
				{ length: count },
				(_, i) => (
					<li key={`ph-${i}`} class="ntf-row ntf-row--placeholder" aria-hidden="true">
						<Skeleton shape="circle" animation="shimmer" class="ntf-row__lead-ph" />
						<span class="ntf-row__body">
							<span class="ntf-row__title ntf-ph__line">
								<Skeleton shape="text" animation="shimmer" width="55%" />
							</span>
							<span class="ntf-row__text ntf-ph__line">
								<Skeleton shape="text" animation="shimmer" />
							</span>
							<span class="ntf-row__meta ntf-ph__line">
								<Skeleton shape="text" animation="shimmer" width="35%" />
							</span>
						</span>
					</li>
				),
			)}
		</>
	);
}

/**
 * NotificationList — the inbox body shared by the drawer and the page (DESIGN_SYSTEM §D.9.6): shimmer
 * placeholder rows on the first read and under the list while "Load more" reads, the error notice
 * with Try again, the `bell` empty state, the hairline-separated rows, and the polite live region the
 * feed's announcer writes to.
 */
export function NotificationList(props: NotificationListProps): JSX.Element {
	const { feed, now, emptyTitle, emptyDescription, archivable, selected, onSelect, onNavigate } =
		props;
	const items = feed.items.value;
	const phase = feed.phase.value;
	const more = feed.loadingMore.value;

	const open = (item: NotificationInboxItem) => {
		void feed.markRead([item.id], !!item.actionUrl);
		if (item.actionUrl) onNavigate?.();
	};

	let body: JSX.Element;
	if (phase === "loading") {
		body = (
			<ul class="ntf-list" aria-busy="true" aria-label="Loading notifications">
				<PlaceholderRows count={FIRST_PAGE_PLACEHOLDERS} />
			</ul>
		);
	} else if (phase === "error") {
		body = (
			<InlineNotice
				text={feed.failure.value ?? "We couldn't load your notifications."}
				actionLabel="Try again"
				onAction={() => void feed.reload()}
			/>
		);
	} else if (items.length === 0) {
		body = (
			<EmptyState
				size="sm"
				icon={<Icon name="bell" />}
				title={emptyTitle}
				description={emptyDescription}
			/>
		);
	} else {
		body = (
			<>
				<ul class="ntf-list" role="list" aria-busy={more ? "true" : undefined}>
					{items.map((item) => (
						<NotificationRow
							key={item.id}
							item={item}
							now={now}
							onOpen={open}
							onArchive={archivable ? (i) => void feed.archive([i.id]) : undefined}
							selected={selected?.has(item.id)}
							onSelect={onSelect}
						/>
					))}
					{more ? <PlaceholderRows count={NEXT_PAGE_PLACEHOLDERS} /> : null}
				</ul>
				{feed.cursor.value
					? (
						<div class="ntf-list__more">
							<Button
								variant="outlined"
								severity="neutral"
								size="sm"
								label="Load more"
								aria-busy={more ? "true" : undefined}
								onClick={() => void feed.loadMore()}
							/>
						</div>
					)
					: null}
			</>
		);
	}

	return (
		<>
			{phase === "ready" && feed.failure.value ? <InlineNotice text={feed.failure.value} /> : null}
			{body}
			<p class="ui-visually-hidden" role="status" aria-live="polite">{feed.announcement.value}</p>
		</>
	);
}
