import type { ComponentChildren, JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { DiscloseIcon, DmIcon, HashIcon, StagesIcon, TeamsIcon } from "./detail-glyphs.tsx";
import { PlusIcon } from "./glyphs.tsx";
import { StageStatusIcon } from "./StageStatusIcon.tsx";
import type { ChannelFilterKey } from "./ChannelQuickFilters.tsx";
import { channelHref } from "../core/chat-context.ts";
import type {
	DmChannel,
	ProjectChannel,
	ProjectDetail,
	StageChannel,
} from "../types/projects-types.ts";

/**
 * ChannelTree — the four-group communication accordion of the Project Details sidebar: General,
 * Stages, Teams, and Private Messages. Each group collapses/expands independently. Every channel row
 * is a real anchor into the project at `/projects/{slug}/{channelId}` (see {@link channelHref}), so
 * the conversation opens in-context; the channel's unified `chatId` remains the shared thread identity
 * the destination page loads (PRODUCT_SPEC §Unified Messaging).
 *
 * Group specifics:
 *   - **Stages**: the client/creator gets an inline "＋" to open Create New Stage (gated on
 *     `viewerIsClient`, re-derived server-side); each stage shows a tiny icon-only
 *     {@link StageStatusIcon} for its actionable state (new ticket / revision / stage-join request).
 *   - **Teams**: a team can be assigned to several stages (sub-labelled rows), and the viewer can be
 *     in several teams — both render cleanly.
 *   - **Private Messages**: only project members the viewer has already messaged appear here (no
 *     global inbox, no scope switch).
 */

// #region Accordion group shell
/**
 * Shared accordion-group props. Exported alongside {@link AccordionGroup} so the session sidebars
 * (the group-session channel tree) reuse the same collapsible group shell + its `project-sidebar.css`
 * styling rather than re-deriving it.
 */
export interface GroupProps {
	id: string;
	icon: JSX.Element;
	label: string;
	open: boolean;
	onToggle: () => void;
	/** Optional inline control rendered in the header (e.g. the Stages "＋" for the client). */
	action?: ComponentChildren;
	/** Live-state dot on the header when something inside is unread. */
	hasUnread?: boolean;
	children: ComponentChildren;
}

export function AccordionGroup(
	{ id, icon, label, open, onToggle, action, hasUnread, children }: GroupProps,
): JSX.Element {
	const panelId = `changroup-${id}`;
	return (
		<div class="proj-chan-group" data-open={open ? "true" : undefined}>
			<div class="proj-chan-group__head">
				<button
					type="button"
					class="proj-chan-group__toggle"
					aria-expanded={open}
					aria-controls={panelId}
					onClick={onToggle}
				>
					<span class="proj-chan-group__chevron" aria-hidden="true">{DiscloseIcon}</span>
					<span class="proj-chan-group__icon" aria-hidden="true">{icon}</span>
					<span class="proj-chan-group__label">{label}</span>
					{hasUnread && (
						<span class="proj-chan-group__dot" role="status" aria-label="has unread channels" />
					)}
				</button>
				{action && <span class="proj-chan-group__action">{action}</span>}
			</div>
			{
				/*
				 * Smoothly reveal/hide via a `grid-template-rows: 0fr → 1fr` transition (see
				 * project-sidebar.css) instead of the instant `hidden` attribute. The panel stays in the DOM
				 * so the height can animate; `inert` when collapsed keeps its links out of the tab order + the
				 * a11y tree, and reduced-motion jumps straight to the final state.
				 */
			}
			<div
				id={panelId}
				class="proj-chan-group__body"
				role="region"
				aria-label={label}
				{...(open ? {} : { inert: true })}
			>
				<div class="proj-chan-group__body-inner">{children}</div>
			</div>
		</div>
	);
}
// #endregion

// #region Channel rows
/** A generic channel row (General / Team channels) — a hash-marked link into the project channel. */
export function ChannelRow(
	{ channel, slug }: { channel: ProjectChannel; slug: string },
): JSX.Element {
	return (
		<a class="proj-chan" href={channelHref(slug, channel.id)}>
			<span class="proj-chan__glyph" aria-hidden="true">{HashIcon}</span>
			<span class="proj-chan__name">{channel.name}</span>
			{channel.sublabel && <span class="proj-chan__sub">{channel.sublabel}</span>}
			{channel.unread && <span class="proj-chan__dot" role="status" aria-label="unread" />}
		</a>
	);
}

/**
 * A stage row — a hash (`#`) channel mark + the stage name, plus a tiny icon-only status signal (new
 * ticket / revision / stage-join request) when the stage has one. Stage channels read as ordinary
 * `#` channels (matching General/Team rows); their lifecycle state surfaces through the trailing
 * status signal + unread dot rather than a leading colour dot. Links into the stage channel.
 */
function StageRow(
	{ stage, slug }: { stage: StageChannel; slug: string },
): JSX.Element {
	return (
		<a
			class="proj-chan proj-chan--stage"
			href={channelHref(slug, stage.id)}
			data-status={stage.status}
		>
			<span class="proj-chan__glyph" aria-hidden="true">{HashIcon}</span>
			<span class="proj-chan__name">{stage.name}</span>
			{stage.activity && (
				<span class="proj-chan__status">
					<StageStatusIcon activity={stage.activity} />
				</span>
			)}
			{stage.channel.unread && <span class="proj-chan__dot" role="status" aria-label="unread" />}
		</a>
	);
}

/** A DM row — a project member the viewer has messaged; opens the DM inside the project. */
export function DmRow(
	{ dm, slug }: { dm: DmChannel; slug: string },
): JSX.Element {
	return (
		<a class="proj-chan proj-chan--dm" href={channelHref(slug, dm.chatId)}>
			<Avatar image={dm.party.avatar ?? undefined} label={dm.party.name} size={22} shape="circle" />
			<span class="proj-chan__name">{dm.party.name}</span>
			{dm.unread && <span class="proj-chan__dot" role="status" aria-label="unread" />}
		</a>
	);
}
// #endregion

// #region Tree
export interface ChannelTreeProps {
	detail: ProjectDetail;
	/** Which groups are expanded (keyed `general|stages|teams|dms`). */
	openGroups: Record<string, boolean>;
	onToggleGroup: (key: string) => void;
	/** Client-only: open the Create New Stage modal. */
	onCreateStage: () => void;
	/** Active quick-filter facets (OR-combined); empty → show everything. */
	filters: ChannelFilterKey[];
}

const anyUnread = (chans: { unread: boolean }[]) => chans.some((c) => c.unread);

export function ChannelTree(
	{ detail, openGroups, onToggleGroup, onCreateStage, filters }: ChannelTreeProps,
): JSX.Element {
	const { general, stages, teams, dms } = detail.channels;
	const slug = detail.slug;
	// Only project members the viewer has already messaged appear in the DM list.
	const projectDms = dms.filter((d) => d.hasProjectContext);

	// #region Quick-filter application (OR-combined; an active row narrows the tree to its matches)
	const filtering = filters.length > 0;
	const has = (k: ChannelFilterKey) => filters.includes(k);
	// `starred` has no channel-level backing yet (deferred to the live backend), so it matches nothing
	// on its own — the empty state below explains a no-result filter.
	const matchChannel = (c: ProjectChannel) => !filtering || (has("unread") && c.unread);
	const matchStage = (s: StageChannel) =>
		!filtering ||
		(has("unread") && s.channel.unread) ||
		(has("tickets") && s.activity === "new_ticket") ||
		(has("revisions") && s.activity === "revision_requested");
	const matchDm = (d: DmChannel) => !filtering || (has("unread") && d.unread);

	const fGeneral = general.filter(matchChannel);
	const fStages = stages.filter(matchStage);
	const fTeams = teams
		.map((t) => ({ ...t, channels: t.channels.filter(matchChannel) }))
		.filter((t) => t.channels.length > 0);
	const fDms = projectDms.filter(matchDm);

	// A group shows if we're not filtering (so empty groups keep their own note) or it has matches.
	// When filtering, force the group open so its matches are revealed regardless of the saved state.
	const show = (n: number) => !filtering || n > 0;
	const groupOpen = (key: string) => (filtering ? true : !!openGroups[key]);

	if (
		filtering && fGeneral.length === 0 && fStages.length === 0 && fTeams.length === 0 &&
		fDms.length === 0
	) {
		return (
			<div class="proj-chan-tree">
				<p class="proj-chan-empty">No channels match these filters.</p>
			</div>
		);
	}
	// #endregion

	return (
		<div class="proj-chan-tree">
			{/* 1 — General */}
			{show(fGeneral.length) && (
				<AccordionGroup
					id="general"
					icon={HashIcon}
					label="General"
					open={groupOpen("general")}
					onToggle={() => onToggleGroup("general")}
					hasUnread={anyUnread(general)}
				>
					{fGeneral.map((c) => <ChannelRow key={c.id} channel={c} slug={slug} />)}
				</AccordionGroup>
			)}

			{/* 2 — Stages (client gets an inline Create New Stage ＋) */}
			{show(fStages.length) && (
				<AccordionGroup
					id="stages"
					icon={StagesIcon}
					label="Stages"
					open={groupOpen("stages")}
					onToggle={() => onToggleGroup("stages")}
					hasUnread={stages.some((s) => s.channel.unread)}
					action={!filtering && detail.viewerIsClient
						? (
							<button
								type="button"
								class="proj-chan-group__plus"
								aria-label="Create new stage"
								onClick={onCreateStage}
							>
								{PlusIcon}
							</button>
						)
						: undefined}
				>
					{fStages.map((s) => <StageRow key={s.id} stage={s} slug={slug} />)}
				</AccordionGroup>
			)}

			{/* 3 — Teams (a team may span several stages; the viewer may be in several teams) */}
			{show(fTeams.length) && (
				<AccordionGroup
					id="teams"
					icon={TeamsIcon}
					label="Teams"
					open={groupOpen("teams")}
					onToggle={() => onToggleGroup("teams")}
					hasUnread={teams.some((t) => anyUnread(t.channels))}
				>
					{fTeams.length === 0
						? <p class="proj-chan-empty">You're not on a team in this project.</p>
						: fTeams.map((team) => (
							<div key={team.teamId} class="proj-team">
								<div class="proj-team__head">
									<Avatar
										image={team.avatar ?? undefined}
										label={team.teamName}
										size={20}
										shape="circle"
									/>
									<span class="proj-team__name">{team.teamName}</span>
									{team.assignedStages.length > 0 && (
										<span class="proj-team__stages">{team.assignedStages.join(" · ")}</span>
									)}
								</div>
								{team.channels.map((c) => <ChannelRow key={c.id} channel={c} slug={slug} />)}
							</div>
						))}
				</AccordionGroup>
			)}

			{/* 4 — Private Messages (project members the viewer has messaged) */}
			{show(fDms.length) && (
				<AccordionGroup
					id="dms"
					icon={DmIcon}
					label="Private Messages"
					open={groupOpen("dms")}
					onToggle={() => onToggleGroup("dms")}
					hasUnread={anyUnread(projectDms)}
				>
					{fDms.length === 0
						? <p class="proj-chan-empty">No project messages yet.</p>
						: fDms.map((dm) => <DmRow key={dm.chatId} dm={dm} slug={slug} />)}
				</AccordionGroup>
			)}
		</div>
	);
}
// #endregion
