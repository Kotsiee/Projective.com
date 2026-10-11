import type { JSX } from "preact";
import type { NotificationInboxItem } from "@projective/types/comms";
import { Avatar } from "@projective/ui/display";
import { Button, Checkbox } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { metaLine } from "../core/notification-model.ts";

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
 * NotificationRow — one inbox row (DESIGN_SYSTEM §D.9): the actor's avatar (the brand initial for the
 * platform itself), the title, the body, and ONE inline meta line in `--text-secondary` — relative
 * time · context · group count — never pills. An unread row sits on the next solid surface step and
 * carries a mark the link's accessible name repeats. The whole row is a link to its `actionUrl`; a row
 * with no unambiguous destination is a button that only marks it read. Archive is a sibling control,
 * never nested in the link.
 */
export function NotificationRow(props: NotificationRowProps): JSX.Element {
	const { item, now, onOpen, onArchive, selected, onSelect } = props;
	const lead = item.actor
		? <UserAvatar label={item.actor.name} image={item.actor.avatar ?? undefined} size="sm" />
		: <Avatar label="Projective" size="sm" />;
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
							value={!!selected}
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
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						class="ntf-row__archive"
						icon={<Icon name="archive-box" />}
						aria-label={`Archive: ${item.title}`}
						onClick={() => onArchive(item)}
					/>
				)
				: null}
		</li>
	);
}
