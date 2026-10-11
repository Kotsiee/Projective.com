import type { JSX } from "preact";
import type { SavedEntityType, SavedItem } from "@projective/types/org";
import { Button } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { metaLine } from "../core/saved-model.ts";

/** The glyph a row with no picture shows, per kind. */
const GLYPH: Readonly<Record<SavedEntityType, IconName>> = {
	service: "service",
	product: "box",
	article: "document",
	profile: "user",
	project: "projects",
	project_channel: "channel",
	conversation: "message",
	message: "message",
	file: "attachment",
};

/** Props for {@link SavedRow}. */
export interface SavedRowProps {
	item: SavedItem;
	/** The clock the relative time reads. */
	now: number;
	/** Remove it from saved (un-save, or unfollow a "People you follow" row). */
	onRemove: (item: SavedItem) => void;
	/** File it into a collection — offered only for a bookmark kind. */
	onCollect?: (item: SavedItem) => void;
}

/**
 * SavedRow — one `/saved` row: a picture (a person's avatar, a listing's or file's thumbnail, else the
 * kind's glyph), the title as a link to the thing, and ONE inline meta line in `--text-secondary` —
 * kind · owner or place · when — never pills. Add to collection and Remove are sibling icon controls,
 * never inside the link, each named with the row's title.
 */
export function SavedRow({ item, now, onRemove, onCollect }: SavedRowProps): JSX.Element {
	const person = item.type === "profile" || item.type === "conversation";
	const lead = person
		? <UserAvatar label={item.title} image={item.thumbnail ?? undefined} size="sm" />
		: item.thumbnail
		? <img class="svd-row__thumb" src={item.thumbnail} alt="" loading="lazy" />
		: <span class="svd-row__glyph"><Icon name={GLYPH[item.type]} /></span>;
	const body = (
		<>
			<span class="svd-row__lead" aria-hidden="true">{lead}</span>
			<span class="svd-row__body">
				<span class="svd-row__title">{item.title}</span>
				<span class="svd-row__meta">{metaLine(item, now)}</span>
			</span>
		</>
	);

	return (
		<li class="svd-row">
			{item.href ? <a class="svd-row__main" href={item.href}>{body}</a> : <span class="svd-row__main">{body}</span>}
			{onCollect
				? (
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						class="svd-row__action"
						icon={<Icon name="folder" />}
						aria-label={`Add to collection: ${item.title}`}
						onClick={() => onCollect(item)}
					/>
				)
				: null}
			<Button
				variant="text"
				severity="secondary"
				size="sm"
				iconOnly
				class="svd-row__action"
				icon={<Icon name={item.following ? "user-minus" : "star"} filled={!item.following} />}
				aria-label={item.following ? `Unfollow: ${item.title}` : `Remove from saved: ${item.title}`}
				onClick={() => onRemove(item)}
			/>
		</li>
	);
}
