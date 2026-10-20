import type { JSX } from "preact";
import "@web/features/projects/styles/project-sidebar.css";
import { channelLabel, type EntityChannel } from "@projective/types/workspace";
import { HashIcon } from "@web/features/projects/components/detail-glyphs.tsx";
import { PlusIcon } from "@web/features/projects/components/glyphs.tsx";
import { channelUnreadLabel, type LaneChannelsZone } from "../../core/lane-model.ts";
import { channelMarkOf } from "../../core/channel-model.ts";

/**
 * ChannelList — the entity's channels drawn exactly as the Project Details lane draws its channels
 * (`projects/components/ChannelTree.tsx` `ChannelRow`, Decision #307): one `.proj-chan` anchor per
 * channel — its mark (photo, then emoji, then the project lane's hash glyph), its display name, and the
 * unread dot — the one being rendered marked
 * `data-active` and `aria-current="page"`. The rows and their stylesheet are the project lane's own, so
 * the two lanes cannot drift. The read lists the default channel first.
 */
export function ChannelList(
	props: { channels: readonly EntityChannel[]; zone: LaneChannelsZone },
): JSX.Element {
	if (props.channels.length === 0) {
		return <p class="proj-chan-empty">No channels yet.</p>;
	}
	return (
		<>
			{props.channels.map((channel) => {
				const active = props.zone.active === channel.slug;
				const unread = channelUnreadLabel(channel.unreadCount);
				const mark = channelMarkOf(channel);
				return (
					<a
						key={channel.id}
						class="proj-chan"
						href={`${props.zone.base}/${encodeURIComponent(channel.slug)}`}
						data-active={active ? "true" : undefined}
						aria-current={active ? "page" : undefined}
					>
						<span class="proj-chan__glyph" aria-hidden="true">
							{mark.kind === "photo"
								? <img class="wsp-chanmark__photo" src={mark.src} alt="" decoding="async" />
								: mark.kind === "emoji"
								? mark.emoji
								: HashIcon}
						</span>
						<span class="proj-chan__name">{channelLabel(channel)}</span>
						{unread && <span class="proj-chan__dot" role="status" aria-label={unread} />}
					</a>
				);
			})}
		</>
	);
}

/**
 * The Channels section's add control — the Project Details lane's Stages "＋"
 * (`.proj-chan-group__plus`), so the two section headers carry the same control.
 */
export function ChannelAddButton(
	props: { label: string; onClick: () => void },
): JSX.Element {
	return (
		<button
			type="button"
			class="proj-chan-group__plus"
			aria-label={props.label}
			aria-haspopup="dialog"
			onClick={props.onClick}
		>
			{PlusIcon}
		</button>
	);
}
