import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { NotificationInboxItem } from "@projective/types/comms";
import { Button, Checkbox } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { metaLine } from "../core/notification-model.ts";
import { CATEGORY_ICON } from "../core/inbox-icons.ts";

/** Props for {@link NotificationRow}. */
export interface NotificationRowProps {
	item: NotificationInboxItem;
	/** The clock the relative time reads. */
	now: number;
	/** The row was opened — mark it read (its link navigates on its own). */
	onOpen: (item: NotificationInboxItem) => void;
	/** Archive the row; omitted in the Archived view, where there is nothing left to dismiss. */
	onArchive?: (item: NotificationInboxItem) => void;
	/** Bulk selection (the page only): whether the row is ticked, and the toggle. */
	selected?: boolean;
	onSelect?: (item: NotificationInboxItem, on: boolean) => void;
}

/**
 * NotificationRow — one inbox row (DESIGN_SYSTEM §D.9.4): the actor's `UserAvatar` (the default
 * picture, then initials, when theirs is missing), or the category's glyph on a solid `--surface-2`
 * tile for the platform's own rows; the title; the body clamped to two lines; and ONE inline meta line
 * in `--text-secondary` — category · context · time · group count — never pills. An unread row sits
 * on the next solid surface step and carries a dot the link's accessible name repeats. The whole row
 * is a link to its `actionUrl`; a row with no unambiguous destination is a button that only marks it
 * read. Archive is a sibling control, never nested in the link, revealed on hover or focus.
 */
export function NotificationRow(props: NotificationRowProps): JSX.Element {
	const { item, now, onOpen, onArchive, selected, onSelect } = props;
	const ticked = useSignal(!!selected);
	useEffect(() => {
		ticked.value = !!selected;
	}, [selected]);

	const lead = item.actor
		? <UserAvatar label={item.actor.name} image={item.actor.avatar ?? undefined} size="sm" />
		: (
			<span class="ntf-row__glyph">
				<Icon name={CATEGORY_ICON[item.category]} size="sm" />
			</span>
		);
	const content = (
		<>
			<span class="ntf-row__lead" aria-hidden="true">{lead}</span>
			<span class="ntf-row__body">
				<span class="ntf-row__title">
					{item.isUnread ? <span class="ui-visually-hidden">Unread:</span> : null}
					{item.title}
				</span>
				<span class="ntf-row__text">{item.body}</span>
				<span class="ntf-row__meta">{metaLine(item, now)}</span>
			</span>
		</>
	);

	return (
		<li class={`ntf-row${item.isUnread ? " ntf-row--unread" : ""}`}>
			{onSelect
				? (
					<span class="ntf-row__select">
						<Checkbox
							value={ticked}
							aria-label={`Select: ${item.title}`}
							onValueChange={(on) => onSelect(item, on)}
						/>
					</span>
				)
				: null}
			{item.actionUrl
				? (
					<a class="ntf-row__main" href={item.actionUrl} onClick={() => onOpen(item)}>
						{content}
					</a>
				)
				: (
					<button type="button" class="ntf-row__main" onClick={() => onOpen(item)}>
						{content}
					</button>
				)}
			{item.isUnread ? <span class="ntf-row__mark" aria-hidden="true" /> : null}
			{onArchive
				? (
					<span class="ntf-row__archive">
						<Tooltip content="Archive" placement="left">
							<Button
								variant="text"
								severity="secondary"
								size="sm"
								iconOnly
								icon={<Icon name="archive-box" />}
								aria-label={`Archive: ${item.title}`}
								onClick={() => onArchive(item)}
							/>
						</Tooltip>
					</span>
				)
				: null}
		</li>
	);
}
