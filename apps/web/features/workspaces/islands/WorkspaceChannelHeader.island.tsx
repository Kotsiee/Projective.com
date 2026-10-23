import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
// The project channel-header chrome (`.chan-*`) verbatim, so an entity channel reads as the same room
// as a project channel and a conversation; the island import bundles it (and the details panel's
// styles) onto the console's channel routes.
import "@web/features/projects/styles/channel-header.css";
import "../styles/workspace.css";
import { Avatar } from "@projective/ui/display";
import { ConfirmDialog, Drawer, Popover, Toast, Tooltip, useToast } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { TabStrip, useMediaQuery } from "@projective/ui/navigation";
import { channelLabel, type EntityChannel, type WorkspaceKind } from "@projective/types/workspace";
import { MessagingIcon } from "@web/features/messaging/components/messaging-glyphs.tsx";
import { MessagingService } from "@web/features/messaging/core/MessagingService.ts";
import { openPopout } from "@web/features/messaging/core/popout-state.ts";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextPanelDocked,
	toggleContextPanel,
} from "@web/features/shell/core/context-panel-state.ts";
import { toggleSaved } from "@features/saved/core/saved-state.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	CHANNEL_TABS,
	channelMarkOf,
	channelTabHref,
	type ChannelTabKey,
} from "../core/channel-model.ts";
import {
	ChannelDetailsBody,
	type ChannelDetailsInfo,
	WSP_CHANNEL_PANEL_ID,
} from "../components/ChannelDetails.tsx";
import { ChannelEditDialog } from "../components/ChannelEditDialog.tsx";

/**
 * WorkspaceChannelHeader — the header band on a team's or business's channel (Decision #308), the
 * entity twin of the project `ChannelHeader` and the `/messages` `ConversationHeader`: it wears their
 * `.chan-header` chrome, so the three rooms read as one product.
 *
 *   - **Identity** — the channel's mark (image → emoji → `#`), its name and its topic.
 *   - **Views** — Chat · Files as link tabs ({@link TabStrip}); each view is an address.
 *   - **Actions** — Favourite (the viewer's own star, `comms.dm_participants.is_starred` through the
 *     saved system), Details (the docked right panel on Chat from 1280px, else a drawer), Pop out chat
 *     (the shell's floating messenger) and a kebab: Mute, Edit channel, Archive channel and Copy link.
 *
 * There is no Leave: every member of the entity is in every channel (Decision #306), so the kebab offers
 * Archive to whoever may (the channel's creator or a `manage_settings` holder), never on the default.
 * Dumb: every write goes through a thin client service to an `/api` route.
 */

// #region Tab icons
const TAB_ICON: Record<ChannelTabKey, JSX.Element> = {
	chat: <MessagingIcon name="chat" />,
	files: <MessagingIcon name="files" />,
};
// #endregion

/** Props for {@link WorkspaceChannelHeader}. */
export interface WorkspaceChannelHeaderProps {
	kind: WorkspaceKind;
	/** The entity's row id. */
	entityId: string;
	channel: EntityChannel;
	/** The conversation the chat stack opens for this channel. */
	conversationId: string;
	/** `/teams/:h/channels` — where an archived channel sends the reader. */
	channelsBase: string;
	/** `/teams/:h/channels/:slug` — the channel's own address; the views hang off it. */
	channelBase: string;
	activeTab: ChannelTabKey;
	details: ChannelDetailsInfo;
}

export default function WorkspaceChannelHeader(props: WorkspaceChannelHeaderProps): JSX.Element {
	// #region State
	const { channel, activeTab, channelBase } = props;
	const label = channelLabel(channel);
	const mark = channelMarkOf(channel);
	const starred = useSignal(channel.starred ?? false);
	const muted = useSignal(channel.muted ?? false);
	const menuOpen = useSignal(false);
	const editOpen = useSignal(false);
	const confirmArchive = useSignal(false);
	const archiving = useSignal(false);
	const drawerOpen = useSignal(false);
	const copied = useSignal(false);
	const toastMounted = useSignal(false);
	const toast = useToast();
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	// The frame's docked panel exists on the Chat view only; every other view opens the drawer.
	const panelDocks = activeTab === "chat" && inflow;
	const detailsShown = panelDocks ? contextPanelDocked.value : drawerOpen.value;
	const canManage = channel.canManage === true;
	const canArchive = canManage && !channel.isDefault;
	// #endregion

	// #region Actions
	function say(severity: "success" | "danger", summary: string): void {
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity, summary, life: severity === "success" ? 3000 : 6000 });
	}

	/** Favourite or unfavourite the channel for the viewer, optimistic with rollback. */
	async function toggleStar(): Promise<void> {
		const out = await toggleSaved(
			"conversation",
			props.conversationId,
			!starred.value,
			(v) => (starred.value = v),
		);
		if (out.message) say(out.ok ? "success" : "danger", out.message);
	}

	/** Mute or unmute for the viewer only, optimistic with rollback. */
	async function toggleMute(): Promise<void> {
		const next = !muted.value;
		muted.value = next;
		const res = await MessagingService.setMuted(props.conversationId, next);
		if (!res.ok) {
			muted.value = !next;
			say("danger", res.message ?? "That mute couldn't be saved. Try again.");
			return;
		}
		say("success", next ? `# ${label} muted.` : `# ${label} unmuted.`);
	}

	function showDetails(): void {
		if (panelDocks) toggleContextPanel();
		else drawerOpen.value = true;
	}

	function popOut(): void {
		openPopout({
			scope: "conversation",
			projectId: props.conversationId,
			channelId: props.conversationId,
			conversationId: props.conversationId,
			title: `# ${label}`,
			href: channelBase,
		});
	}

	function copyLink(): void {
		try {
			navigator.clipboard?.writeText(`${location.origin}${channelBase}`);
			copied.value = true;
			setTimeout(() => (copied.value = false), 1600);
		} catch { /* clipboard blocked — non-fatal */ }
	}

	/** Archive the channel and land on the entity's default one. */
	async function archive(): Promise<void> {
		if (archiving.value) return;
		archiving.value = true;
		const res = await WorkspaceService.archiveChannel({
			kind: props.kind,
			id: props.entityId,
			channelId: channel.id,
		});
		archiving.value = false;
		confirmArchive.value = false;
		if (!res.ok) {
			say("danger", res.message ?? "The channel couldn't be archived. Nothing was changed.");
			return;
		}
		globalThis.location.assign(props.channelsBase);
	}
	// #endregion

	return (
		<header class="chan-header wsp-chan-header">
			{/* #region Identity */}
			<div class="chan-header__meta">
				<span class="chan-header__avatar wsp-chan-mark" aria-hidden="true">
					{mark.kind === "photo"
						? <Avatar image={mark.src} label={label} size={30} shape="square" />
						: mark.kind === "emoji"
						? <span class="wsp-chan-mark__emoji">{mark.emoji}</span>
						: <span class="wsp-chan-mark__hash">#</span>}
				</span>
				<div class="chan-header__idblock">
					<h1 class="chan-header__title">{label}</h1>
					<p class="chan-header__sub">
						{channel.topic ?? `${props.details.members.length} members`}
					</p>
				</div>
			</div>
			{/* #endregion */}

			{/* #region Views */}
			<TabStrip
				label="Channel views"
				activeKey={activeTab}
				items={CHANNEL_TABS.map((tab) => ({
					key: tab.key,
					label: tab.label,
					href: channelTabHref(channelBase, tab.key),
					icon: TAB_ICON[tab.key],
				}))}
			/>
			{/* #endregion */}

			{/* #region Actions */}
			<div class="chan-header__actions">
				<Tooltip
					content={starred.value ? "Remove from favourites" : "Favourite"}
					placement="bottom"
				>
					<button
						type="button"
						class="chan-action chan-action--star"
						data-on={starred.value ? "true" : undefined}
						aria-pressed={starred.value}
						aria-label={starred.value ? "Remove channel from favourites" : "Favourite channel"}
						onClick={toggleStar}
					>
						<MessagingIcon name="star" />
					</button>
				</Tooltip>

				<Tooltip content="Details" placement="bottom">
					<button
						type="button"
						class="chan-action"
						data-on={detailsShown ? "true" : undefined}
						aria-label="Channel details"
						aria-expanded={detailsShown}
						aria-controls={panelDocks ? WSP_CHANNEL_PANEL_ID : undefined}
						onClick={showDetails}
					>
						<MessagingIcon name="details" />
					</button>
				</Tooltip>

				<Tooltip content="Pop out chat" placement="bottom">
					<button type="button" class="chan-action" aria-label="Pop out chat" onClick={popOut}>
						<MessagingIcon name="popout" />
					</button>
				</Tooltip>

				<Popover
					open={menuOpen}
					placement="bottom-end"
					class="chan-menu-pop"
					trigger={(api) => (
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="chan-action"
							data-on={api.expanded ? "true" : undefined}
							aria-haspopup="menu"
							aria-label="Channel actions"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							<MessagingIcon name="kebab" />
						</button>
					)}
				>
					<div class="chan-menu" role="menu" aria-label="Channel actions">
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={muted.value}
							class="chan-menu__item"
							onClick={() => {
								menuOpen.value = false;
								void toggleMute();
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">
								<MessagingIcon name={muted.value ? "bell" : "mute"} />
							</span>
							<span class="chan-menu__label">
								{muted.value ? "Unmute channel" : "Mute channel"}
							</span>
						</button>
						{canManage && (
							<button
								type="button"
								role="menuitem"
								class="chan-menu__item"
								onClick={() => {
									menuOpen.value = false;
									editOpen.value = true;
								}}
							>
								<span class="chan-menu__icon" aria-hidden="true">
									<Icon name="edit" size="sm" />
								</span>
								<span class="chan-menu__label">Edit channel</span>
							</button>
						)}
						<button
							type="button"
							role="menuitem"
							class="chan-menu__item"
							onClick={() => {
								copyLink();
								menuOpen.value = false;
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">
								<Icon name="link" size="sm" />
							</span>
							<span class="chan-menu__label">{copied.value ? "Link copied" : "Copy link"}</span>
						</button>
						{canArchive && (
							<button
								type="button"
								role="menuitem"
								class="chan-menu__item"
								onClick={() => {
									menuOpen.value = false;
									confirmArchive.value = true;
								}}
							>
								<span class="chan-menu__icon" aria-hidden="true">
									<MessagingIcon name="archive" />
								</span>
								<span class="chan-menu__label">Archive channel</span>
							</button>
						)}
					</div>
				</Popover>
			</div>
			{/* #endregion */}

			<Drawer
				visible={drawerOpen}
				position="right"
				size="21rem"
				header="Channel details"
				class="chan-detail-drawer"
			>
				<ChannelDetailsBody info={props.details} />
			</Drawer>

			{canManage && (
				<ChannelEditDialog
					kind={props.kind}
					entityId={props.entityId}
					channel={channel}
					conversationId={props.conversationId}
					visible={editOpen}
				/>
			)}

			{canArchive && (
				<ConfirmDialog
					visible={confirmArchive}
					header={`Archive # ${label}?`}
					message="It leaves the channel list and takes no new messages. Its history stays, and nothing is deleted."
					acceptLabel={archiving.value ? "Archiving…" : "Archive"}
					rejectLabel="Keep it"
					acceptSeverity="danger"
					onAccept={() => void archive()}
				/>
			)}

			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</header>
	);
}
