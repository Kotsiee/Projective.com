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
	/** The empty state's sentence for the current tab and view. */
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

/**
 * NotificationList — the inbox body shared by the drawer and the page (DESIGN_SYSTEM §D.9): loading
 * rows, the error notice with Retry, the empty state, the hairline-separated rows, keyset "Load more",
 * and the polite live region the feed's announcer writes to. It renders inside the caller's
 * `role="tabpanel"`.
 */
export function NotificationList(props: NotificationListProps): JSX.Element {
	const { feed, now, emptyTitle, emptyDescription, archivable, selected, onSelect, onNavigate } =
		props;
	const items = feed.items.value;
	const phase = feed.phase.value;

	const open = (item: NotificationInboxItem) => {
		void feed.markRead([item.id], !!item.actionUrl);
		if (item.actionUrl) onNavigate?.();
	};

	let body: JSX.Element;
	if (phase === "loading") {
		body = (
			<ul class="ntf-list" aria-busy="true" aria-label="Loading notifications">
				{[0, 1, 2, 3].map((i) => (
					<li key={i} class="ntf-row ntf-row--placeholder" aria-hidden="true">
						<Skeleton shape="circle" class="ntf-row__lead-ph" />
						<Skeleton lines={2} class="ntf-row__body" />
					</li>
				))}
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
				<ul class="ntf-list" role="list">
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
				</ul>
				{feed.cursor.value
					? (
						<div class="ntf-list__more">
							<Button
								variant="text"
								size="sm"
								label={feed.loadingMore.value ? "Loading…" : "Load more"}
								disabled={feed.loadingMore.value}
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
