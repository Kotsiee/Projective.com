import type { JSX } from "preact";
import { NavItem } from "@projective/ui/navigation";
import type { EntityChannel } from "@projective/types/workspace";
import { channelUnreadLabel, type LaneChannelsZone } from "../../core/lane-model.ts";
import { ChannelGlyph, cloneGlyph } from "../../core/workspace-glyphs.tsx";

/**
 * ChannelList — the entity's channels as `NavItem` rows: the hash glyph and the channel's name, the one
 * being rendered marked `aria-current="page"`, unread messages as a plain tabular count at the row's
 * end (in its accessible name too). The read lists the default channel first.
 */
export function ChannelList(
	props: { channels: readonly EntityChannel[]; zone: LaneChannelsZone },
): JSX.Element {
	if (props.channels.length === 0) {
		return <p class="wsp-lane__channelnote">No channels yet.</p>;
	}
	return (
		<ul class="wsp-lane__navlist" role="list">
			{props.channels.map((channel) => {
				const unread = channelUnreadLabel(channel.unreadCount);
				return (
					<li key={channel.id}>
						<NavItem
							href={`${props.zone.base}/${encodeURIComponent(channel.slug)}`}
							label={channel.slug}
							icon={cloneGlyph(ChannelGlyph)}
							active={props.zone.active === channel.slug}
							dot={unread !== null}
							dotLabel={unread ?? undefined}
							trailing={unread
								? <span class="wsp-lane__navcount">{channel.unreadCount}</span>
								: undefined}
						/>
					</li>
				);
			})}
		</ul>
	);
}
