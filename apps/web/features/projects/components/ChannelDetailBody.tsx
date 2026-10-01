import { cloneElement, type JSX } from "preact";
import { ClockIcon } from "./detail-glyphs.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * ChannelDetailBody — a project channel's details (kind · status · deadline · progress · members). One
 * tree for both presentations: the middle-nav frame's docked right panel on a channel's Chat view
 * (`channelPanelFor`, from 1280px) and the `ChannelHeader`'s slide-over drawer everywhere else. Static —
 * its styles ship with `channel-header.css`, which the header island carries onto every channel route.
 */

/** The docked details panel's id — the header's Details toggle names it in `aria-controls`. */
export const CHANNEL_PANEL_ID = "chan-details-panel";

// #region Detail info
/**
 * The resolved summary the details panel and drawer render — computed server-side by `channelHeaderFor` and
 * threaded as a serializable prop, so the drawer paints the real (SSR-resolved) engagement facts.
 */
export interface ChannelDetailInfo {
	/** Human label for the channel group (e.g. "Stage", "General channel", "Direct message"). */
	kindLabel: string;
	/** The stage/engagement lifecycle status, when relevant. */
	statusLabel?: string;
	/** A pre-formatted deadline label (e.g. "Due Fri · Jul 25"); deterministic, no timezone drift. */
	deadlineLabel?: string;
	/** Completed vs total tasks for the progress meter (stage channels only). */
	progress?: { done: number; total: number };
	/** The assigned members shown as an avatar stack + count. */
	members: { name: string; avatar: string | null }[];
}
// #endregion

// #region Body
/** The details body; `isStage` adds the progress meter and names the roster "Assigned members". */
export function ChannelDetailBody(
	{ title, isStage, info }: { title: string; isStage: boolean; info: ChannelDetailInfo },
): JSX.Element {
	const pct = info.progress && info.progress.total > 0
		? Math.round((info.progress.done / info.progress.total) * 100)
		: null;

	return (
		<div class="chan-details">
			<dl class="chan-details__list">
				<div class="chan-details__row">
					<dt class="chan-details__term">Channel</dt>
					<dd class="chan-details__def">{info.kindLabel}</dd>
				</div>
				{info.statusLabel && (
					<div class="chan-details__row">
						<dt class="chan-details__term">Status</dt>
						<dd class="chan-details__def">{info.statusLabel}</dd>
					</div>
				)}
				{info.deadlineLabel && (
					<div class="chan-details__row">
						<dt class="chan-details__term">
							<span class="chan-details__termicon" aria-hidden="true">
								{cloneElement(ClockIcon)}
							</span>
							Deadline
						</dt>
						<dd class="chan-details__def">{info.deadlineLabel}</dd>
					</div>
				)}
			</dl>

			{isStage && pct !== null && (
				<div class="chan-progress" role="group" aria-label="Stage progress">
					<div class="chan-progress__head">
						<span class="chan-progress__label">Progress</span>
						<span class="chan-progress__value">
							{info.progress!.done}/{info.progress!.total} tasks · {pct}%
						</span>
					</div>
					<div
						class="chan-progress__track"
						role="progressbar"
						aria-valuenow={pct}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label={`${title} progress`}
					>
						<span class="chan-progress__fill" style={`inline-size:${pct}%`} />
					</div>
				</div>
			)}

			{info.members.length > 0 && (
				<div class="chan-members">
					<div class="chan-members__head">
						<span class="chan-members__label">
							{isStage ? "Assigned members" : "Members"}
						</span>
						<span class="chan-members__count">{info.members.length}</span>
					</div>
					<ul class="chan-members__list">
						{info.members.map((m) => (
							<li key={m.name} class="chan-members__item">
								<UserAvatar image={m.avatar ?? undefined} label={m.name} size={26} shape="circle" />
								<span class="chan-members__name">{m.name}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			<p class="chan-details__note">
				{isStage
					? "Deadlines, progress, and assignments will sync from the live stage once the backend is connected."
					: "Channel metadata will sync from the live backend once it is connected."}
			</p>
		</div>
	);
}
// #endregion

// #region Docked panel
/**
 * ChannelDetailsPanel — the docked presentation: a titled aside the middle-nav frame's right panel
 * hosts. The drawer brings its own title bar; docked, the panel carries the same label as its heading.
 */
export function ChannelDetailsPanel(
	{ label, title, isStage, info }: {
		label: string;
		title: string;
		isStage: boolean;
		info: ChannelDetailInfo;
	},
): JSX.Element {
	return (
		<aside
			id={CHANNEL_PANEL_ID}
			class="chan-details-panel"
			aria-labelledby={`${CHANNEL_PANEL_ID}-title`}
		>
			<h2 id={`${CHANNEL_PANEL_ID}-title`} class="chan-details-panel__title">{label}</h2>
			<ChannelDetailBody title={title} isStage={isStage} info={info} />
		</aside>
	);
}
// #endregion
