import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Popover } from "@projective/ui/feedback";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import { contextIsOffering, contextLabel, splitPreview } from "../core/inbox-model.ts";
import type { ConversationSummary } from "../types/messaging-types.ts";

/**
 * InboxRow — one conversation in the `/messages` BODY list. The counterpart of {@link ConversationRow}
 * (which stays the lane's navigation row beside an open thread), sized for the content region rather
 * than a 280px column.
 *
 * The width buys three things the lane row could not afford: the preview runs at its natural measure
 * instead of clipping at 47%, the engagement context (`serviceName` / `productName` / `entityName`)
 * finally renders, and the state marks get their own trailing column instead of stealing from the text.
 *
 * The row is one anchor with a trailing action cluster as its SIBLING (never nested) — the kebab is
 * absolutely positioned over the metadata column so it costs the text nothing at rest, and swaps with
 * the timestamp on hover/focus rather than reserving width beside it.
 */

// #region Props
export interface InboxRowProps {
	conversation: ConversationSummary;
	href: string;
	active: boolean;
	/** `compact` drops the context line and the second preview line. */
	compact: boolean;
	onToggleStar: (id: string) => void;
	onToggleArchive: (id: string) => void;
	onToggleMute: (id: string) => void;
	onDelete: (id: string) => void;
}
// #endregion

/** The global site sidebar the kebab's menu must never slide under. */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

export function InboxRow(props: InboxRowProps): JSX.Element {
	const { conversation: c, href, active, compact } = props;
	const menuOpen = useSignal(false);
	const context = contextLabel(c);
	const { speaker, body } = splitPreview(c.preview);

	return (
		<div
			class="inbox-row"
			data-active={active ? "true" : undefined}
			data-unread={c.unread ? "true" : undefined}
			data-menu={menuOpen.value ? "true" : undefined}
		>
			{/* The unread mark lives in the gutter, so it costs the text column nothing. */}
			<span class="inbox-row__mark" aria-hidden="true" />

			<a class="inbox-row__link" href={href} aria-current={active ? "page" : undefined}>
				<span class="inbox-row__avatar">
					<Avatar
						image={c.avatar ?? undefined}
						label={c.title}
						size={compact ? 32 : 40}
						shape={c.kind === "group" ? "square" : "circle"}
					/>
					{c.muted && (
						<span class="inbox-row__muted" aria-hidden="true">
							<MessagingIcon name="mute" />
						</span>
					)}
				</span>

				<span class="inbox-row__identity">
					<span class="inbox-row__name">{c.title}</span>
					{context && !compact && (
						<span
							class="inbox-row__context"
							data-offering={contextIsOffering(c) ? "true" : undefined}
						>
							{context}
						</span>
					)}
				</span>

				<span class="inbox-row__preview">
					{speaker && <span class="inbox-row__speaker">{speaker}:</span>}
					<span class="inbox-row__snippet">{body || "No messages yet"}</span>
				</span>

				<span class="inbox-row__meta">
					{c.starred && (
						<span class="inbox-row__starred" aria-label="Starred">
							<MessagingIcon name="star" />
						</span>
					)}
					<span class="inbox-row__time">{c.lastActivityLabel}</span>
				</span>
			</a>

			<Popover
				open={menuOpen}
				placement="bottom-end"
				class="conv-menu-pop"
				avoid={SHELL_AVOID}
				trigger={(api) => (
					<button
						type="button"
						ref={api.ref as RefObject<HTMLButtonElement>}
						class="inbox-row__kebab"
						data-open={api.expanded ? "true" : undefined}
						aria-haspopup="menu"
						aria-label={`Actions for ${c.title}`}
						aria-expanded={api.expanded}
						aria-controls={api.panelId}
						onClick={api.toggle}
					>
						<MessagingIcon name="kebab" />
					</button>
				)}
			>
				<div class="conv-menu" role="menu" aria-label={`Actions for ${c.title}`}>
					<button
						type="button"
						role="menuitemcheckbox"
						aria-checked={c.starred}
						class="conv-menu__item"
						onClick={() => {
							props.onToggleStar(c.id);
							menuOpen.value = false;
						}}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name="star" />
						</span>
						<span>{c.starred ? "Remove favourite" : "Favourite"}</span>
					</button>
					<button
						type="button"
						role="menuitemcheckbox"
						aria-checked={c.muted}
						class="conv-menu__item"
						onClick={() => {
							props.onToggleMute(c.id);
							menuOpen.value = false;
						}}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name="mute" />
						</span>
						<span>{c.muted ? "Unmute" : "Mute notifications"}</span>
					</button>
					<button
						type="button"
						role="menuitem"
						class="conv-menu__item"
						onClick={() => {
							props.onToggleArchive(c.id);
							menuOpen.value = false;
						}}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name={c.archived ? "unarchive" : "archive"} />
						</span>
						<span>{c.archived ? "Unarchive" : "Archive"}</span>
					</button>
					<button
						type="button"
						role="menuitem"
						class="conv-menu__item"
						data-danger="true"
						onClick={() => {
							props.onDelete(c.id);
							menuOpen.value = false;
						}}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name="trash" />
						</span>
						<span>Delete conversation</span>
					</button>
				</div>
			</Popover>
		</div>
	);
}
