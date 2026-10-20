import type { JSX } from "preact";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import {
	channelLabel,
	type EntityChannel,
	kindCopy,
	type WorkspaceDetail,
} from "@projective/types/workspace";

/**
 * ChannelDetails — an entity channel's details (Decision #308): what it is called, its address, its
 * topic, and the people in it. One tree for both presentations, as a project channel's: the middle-nav
 * frame's docked right panel on the channel's Chat view (`workspaceChannelPanelFor`, from 1280px) and
 * the {@link WorkspaceChannelHeader}'s slide-over drawer everywhere else.
 *
 * It wears the project channel's `.chan-details` / `.chan-members` chrome, so the two rooms read as one
 * product. Static: its styles ship with `channel-header.css`, which the header island carries onto every
 * channel route. Every fact is the console's own detail read — nothing here is a placeholder.
 */

/** The docked details panel's id — the header's Details toggle names it in `aria-controls`. */
export const WSP_CHANNEL_PANEL_ID = "wsp-chan-panel";

// #region Info
/** The serializable summary both presentations render. */
export interface ChannelDetailsInfo {
	/** What the channel is called on screen — its display name, else its slug. */
	label: string;
	slug: string;
	topic: string | null;
	isDefault: boolean;
	/** "Team" / "Business" — whose channel it is. */
	ownerNoun: string;
	/** The entity's name. */
	ownerName: string;
	/** Everyone in the channel: the entity's active members (every member is in every channel). */
	members: { id: string; name: string; avatar: string; role: string | null }[];
}

/** The details for one channel of an entity, from the console's detail read. */
export function channelDetailsInfo(
	ws: WorkspaceDetail,
	channel: EntityChannel,
): ChannelDetailsInfo {
	const roleName = new Map(ws.roles.map((r) => [r.id, r.name]));
	return {
		label: channelLabel(channel),
		slug: channel.slug,
		topic: channel.topic,
		isDefault: channel.isDefault,
		ownerNoun: kindCopy(ws.kind).Noun,
		ownerName: ws.name,
		members: ws.members
			.filter((m) => m.state === "active")
			.map((m) => ({
				id: m.id,
				name: m.name,
				avatar: m.avatar,
				role: roleName.get(m.roleId) ?? null,
			})),
	};
}
// #endregion

// #region Body
/** The details body. */
export function ChannelDetailsBody({ info }: { info: ChannelDetailsInfo }): JSX.Element {
	return (
		<div class="chan-details">
			<dl class="chan-details__list">
				<div class="chan-details__row">
					<dt class="chan-details__term">Name</dt>
					<dd class="chan-details__def">{info.label}</dd>
				</div>
				<div class="chan-details__row">
					<dt class="chan-details__term">Address</dt>
					<dd class="chan-details__def"># {info.slug}</dd>
				</div>
				<div class="chan-details__row">
					<dt class="chan-details__term">Topic</dt>
					<dd class="chan-details__def">{info.topic ?? "No topic yet"}</dd>
				</div>
				<div class="chan-details__row">
					<dt class="chan-details__term">{info.ownerNoun}</dt>
					<dd class="chan-details__def">{info.ownerName}</dd>
				</div>
			</dl>

			{info.members.length > 0 && (
				<div class="chan-members">
					<div class="chan-members__head">
						<span class="chan-members__label">Members</span>
						<span class="chan-members__count">{info.members.length}</span>
					</div>
					<ul class="chan-members__list">
						{info.members.map((m) => (
							<li key={m.id} class="chan-members__item">
								<UserAvatar image={m.avatar || undefined} label={m.name} size={26} shape="circle" />
								<span class="chan-members__name">{m.name}</span>
								{m.role && <span class="wsp-chan-details__role">{m.role}</span>}
							</li>
						))}
					</ul>
				</div>
			)}

			<p class="chan-details__note">
				{info.isDefault
					? `Every member of ${info.ownerName} is here from the day they join, and this channel always stays.`
					: `Everyone in ${info.ownerName} is in every channel.`}
			</p>
		</div>
	);
}
// #endregion

// #region Docked panel
/** The docked presentation: a titled aside the middle-nav frame's right panel hosts. */
export function ChannelDetailsPanel({ info }: { info: ChannelDetailsInfo }): JSX.Element {
	return (
		<aside
			id={WSP_CHANNEL_PANEL_ID}
			class="chan-details-panel"
			aria-labelledby={`${WSP_CHANNEL_PANEL_ID}-title`}
		>
			<h2 id={`${WSP_CHANNEL_PANEL_ID}-title`} class="chan-details-panel__title">
				Channel details
			</h2>
			<ChannelDetailsBody info={info} />
		</aside>
	);
}
// #endregion
