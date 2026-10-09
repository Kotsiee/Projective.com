import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
// Reuse the project channel-header chrome (`.chan-*`) verbatim for a byte-identical look; the island
// import bundles it onto `/messages` routes (where the projects ChannelHeader island isn't mounted).
import "@web/features/projects/styles/channel-header.css";
import "../styles/conversation.css";
import { Avatar } from "@projective/ui/display";
import { Popover, Toast, Tooltip, useToast } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MediaCropPicker } from "@web/features/files/components/media-crop/MediaCropPicker.tsx";
import { ChannelTabStrip } from "@web/features/projects/components/ChannelTabStrip.tsx";
import { useMediaQuery } from "@projective/ui/navigation";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import {
	CONVERSATION_TABS,
	conversationFallbackImage,
	GROUP_PHOTO_FAILED_NOTICE,
} from "../core/conversation-model.ts";
import { MessagingService } from "../core/MessagingService.ts";
import { openPopout } from "../core/popout-state.ts";
import { openAddMembers } from "../core/messaging-state.ts";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
	contextPanelDocked,
	toggleContextPanel,
} from "@web/features/shell/core/context-panel-state.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import type { ConversationDetail, GroupPhotoInput } from "../types/messaging-types.ts";

/**
 * ConversationHeader — the contextual header for a `/messages/[conversationId]` view, mounted into the
 * middle-nav frame's header band (the messaging counterpart of the project `ChannelHeader`; it shares
 * the `.chan-header` chrome for a byte-identical look). It STRICTLY MIRRORS the channel layout but with
 * ONLY the Chat · Files · Members tabs (task §2C). Its right-side actions (task §1 / §2): Star · a
 * **Pop Out Chat** button (opens the floating draggable popover) · a kebab (Mute · Add members ·
 * Copy link). On a one-to-one conversation's Chat tab a Details toggle opens the context panel.
 * Dumb island: star/mute persist optimistically to `localStorage`.
 */

// #region Tab icons
const TAB_ICON: Record<string, JSX.Element> = {
	chat: <MessagingIcon name="chat" />,
	files: <MessagingIcon name="files" />,
	members: <MessagingIcon name="members" />,
};
// #endregion

export interface ConversationHeaderProps {
	detail: ConversationDetail;
	/** The conversation base path — `/messages/{conversationId}`. Tab hrefs hang off this. */
	base: string;
	/** The active view tab key. */
	activeTab: string;
}

// #region Per-conversation preference persistence (shared key with the sidebar)
interface ConvPref {
	starred?: boolean;
	archived?: boolean;
	muted?: boolean;
	deleted?: boolean;
}
function readPrefs(): Record<string, ConvPref> {
	const raw = readStored("local", LocalKeys.CONVERSATION_PREFS);
	if (!raw) return {};
	try {
		return JSON.parse(raw) as Record<string, ConvPref>;
	} catch {
		return {};
	}
}
function writePref(id: string, patch: ConvPref): void {
	const all = readPrefs();
	all[id] = { ...all[id], ...patch };
	writeStored("local", LocalKeys.CONVERSATION_PREFS, JSON.stringify(all));
}
// #endregion

export default function ConversationHeader(props: ConversationHeaderProps): JSX.Element {
	const { detail, base, activeTab } = props;
	const isStarred = useSignal(detail.starred);
	const isMuted = useSignal(detail.muted);
	const menuOpen = useSignal(false);
	const copied = useSignal(false);
	const photoOpen = useSignal(false);
	const toastMounted = useSignal(false);
	const toast = useToast();
	const noticeSaid = useRef(false);
	const isGroup = detail.kind === "group";
	const hasDetails = detail.kind !== "group" && activeTab === "chat";
	const docked = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const detailsOpen = docked ? contextPanelDocked.value : contextDrawerOpen.value;

	// The one-shot `?notice=group-photo-failed` a just-created group opens with: say it once, then strip
	// it (`fClientNav: false`, so Back stays an ordinary navigation — the ProjectNoticeHost rule).
	useEffect(() => {
		if (noticeSaid.current) return;
		const params = new URLSearchParams(location.search);
		if (params.get("notice") !== GROUP_PHOTO_FAILED_NOTICE) return;
		noticeSaid.current = true;
		params.delete("notice");
		const query = params.toString();
		const state = history.state && typeof history.state === "object" ? history.state : {};
		history.replaceState(
			{ ...state, fClientNav: false },
			"",
			`${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
		);
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({
			severity: "warning",
			summary: "Your group was created, but its photo couldn't be set.",
			detail: "Use Change group photo in the menu to try again.",
			life: 6000,
		});
	}, []);

	/** Apply a group photo (or clear it). A full reload re-renders the lane row and this header. */
	async function savePhoto(photo: GroupPhotoInput | null): Promise<string | null> {
		const res = await MessagingService.setGroupPhoto(detail.id, photo);
		if (!res.ok) return res.message ?? "The group photo couldn't be changed. Try again.";
		globalThis.location.reload();
		return null;
	}

	// Layer the persisted star/mute preference on after hydration.
	useEffect(() => {
		const pref = readPrefs()[detail.id];
		if (!pref) return;
		if (pref.starred !== undefined) isStarred.value = pref.starred;
		if (pref.muted !== undefined) isMuted.value = pref.muted;
	}, [detail.id]);

	function toggleStar(): void {
		isStarred.value = !isStarred.value;
		writePref(detail.id, { starred: isStarred.value });
	}
	function toggleMute(): void {
		isMuted.value = !isMuted.value;
		writePref(detail.id, { muted: isMuted.value });
	}
	function copyLink(): void {
		try {
			const url = typeof location !== "undefined" ? `${location.origin}${base}` : base;
			navigator.clipboard?.writeText(url);
			copied.value = true;
			setTimeout(() => (copied.value = false), 1600);
		} catch { /* clipboard blocked — non-fatal */ }
	}
	function popOut(): void {
		openPopout({
			scope: "conversation",
			projectId: detail.id,
			channelId: detail.id,
			conversationId: detail.id,
			title: detail.title,
			href: base,
		});
	}

	return (
		<header class="chan-header">
			{/* Left — conversation identity. */}
			<div class="chan-header__meta">
				<span class="chan-header__avatar" aria-hidden="true">
					<Avatar
						image={detail.avatar ?? undefined}
						fallbackImage={conversationFallbackImage(detail.kind)}
						label={detail.title}
						size={30}
						shape={detail.kind === "group" ? "square" : "circle"}
					/>
				</span>
				<div class="chan-header__idblock">
					<h1 class="chan-header__title">{detail.title}</h1>
					<p class="chan-header__sub">{detail.sub}</p>
				</div>
			</div>

			{/* Centre — underlined view tabs (Chat · Files · Members only). */}
			<ChannelTabStrip
				label="Conversation views"
				activeKey={activeTab}
				tabs={CONVERSATION_TABS.map((tab) => ({
					key: tab.key,
					label: tab.label,
					href: tab.seg ? `${base}/${tab.seg}` : base,
					icon: TAB_ICON[tab.key],
				}))}
			/>

			{/* Right — icon-only actions (star · pop-out · kebab). */}
			<div class="chan-header__actions">
				<button
					type="button"
					class="chan-action chan-action--star"
					data-on={isStarred.value ? "true" : undefined}
					aria-pressed={isStarred.value}
					aria-label={isStarred.value ? "Unstar conversation" : "Star conversation"}
					onClick={toggleStar}
				>
					<MessagingIcon name="star" />
				</button>

				{hasDetails && (
					<Tooltip content="Details" placement="bottom">
						<button
							type="button"
							class="chan-action"
							data-on={detailsOpen ? "true" : undefined}
							aria-label="Conversation details"
							aria-expanded={detailsOpen}
							aria-controls={docked ? "msg-ctx-panel" : undefined}
							onClick={toggleContextPanel}
						>
							<MessagingIcon name="details" />
						</button>
					</Tooltip>
				)}

				<Tooltip content="Pop out chat" placement="bottom">
					<button
						type="button"
						class="chan-action"
						aria-label="Pop out chat"
						onClick={popOut}
					>
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
							aria-label="More actions"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							<MessagingIcon name="kebab" />
						</button>
					)}
				>
					<div class="chan-menu" role="menu" aria-label="Conversation actions">
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={isMuted.value}
							class="chan-menu__item"
							onClick={() => {
								toggleMute();
								menuOpen.value = false;
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">
								<MessagingIcon name="mute" />
							</span>
							<span class="chan-menu__label">
								{isMuted.value ? "Unmute conversation" : "Mute conversation"}
							</span>
						</button>
						{isGroup && (
							<button
								type="button"
								role="menuitem"
								class="chan-menu__item"
								onClick={() => {
									menuOpen.value = false;
									photoOpen.value = true;
								}}
							>
								<span class="chan-menu__icon" aria-hidden="true">
									<Icon name="image" size="sm" />
								</span>
								<span class="chan-menu__label">
									{detail.avatar ? "Change group photo" : "Add group photo"}
								</span>
							</button>
						)}
						{isGroup && detail.avatar && (
							<button
								type="button"
								role="menuitem"
								class="chan-menu__item"
								onClick={() => {
									menuOpen.value = false;
									void savePhoto(null).then((message) => {
										if (!message) return;
										if (!document.querySelector(".ui-toast")) toastMounted.value = true;
										toast.show({ severity: "danger", summary: message, life: 5000 });
									});
								}}
							>
								<span class="chan-menu__icon" aria-hidden="true">
									<MessagingIcon name="trash" />
								</span>
								<span class="chan-menu__label">Remove group photo</span>
							</button>
						)}
						{detail.canAddMembers && (
							<button
								type="button"
								role="menuitem"
								class="chan-menu__item"
								onClick={() => {
									openAddMembers(detail.id, detail.participants.map((p) => p.id));
									menuOpen.value = false;
								}}
							>
								<span class="chan-menu__icon" aria-hidden="true">
									<MessagingIcon name="addMember" />
								</span>
								<span class="chan-menu__label">Add members</span>
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
								<MessagingIcon name="chat" />
							</span>
							<span class="chan-menu__label">{copied.value ? "Link copied" : "Copy link"}</span>
						</button>
					</div>
				</Popover>
			</div>
			{isGroup && (
				<MediaCropPicker
					open={photoOpen}
					requesterId="messaging-group-photo"
					target="avatar"
					title="Group photo"
					saveLabel="Save photo"
					onSave={([choice]) =>
						choice
							? savePhoto({ sourceAssetId: choice.sourceAssetId, crop: choice.crop })
							: Promise.resolve(null)}
				/>
			)}
			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</header>
	);
}
