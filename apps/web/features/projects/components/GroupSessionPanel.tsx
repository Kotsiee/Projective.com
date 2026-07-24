import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { LaneSections } from "@projective/ui/navigation";
import { AccordionGroup, ChannelRow, DmRow } from "./ChannelTree.tsx";
import { DmIcon, HashIcon } from "./detail-glyphs.tsx";
import { ContinuationIcon, LevelsIcon, OverlapIcon, PollIcon } from "./session-glyphs.tsx";
import { channelHref } from "../core/chat-context.ts";
import type { GroupSessionData, SubGroup } from "../core/session-model.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * GroupSessionPanel — the Project Details sidebar body for a **Group Session** service (courses,
 * seminars, multi-client cohorts — task §3.B). Its channel tree replaces the stage tree with:
 *
 *   - **General** — the main course chat & announcements;
 *   - **Sub-groups** — proficiency levels / breakout tracks (each with a level tag + an overlapping-
 *     schedule indicator when its live slot clashes with another);
 *   - **Private messages** — 1-1 threads with individual cohort members.
 *
 * Above the tree it surfaces the cohort dynamics the group format needs: the viewer's active sub-group
 * tags, a live **reschedule-vote** alert (`Reschedule Proposal Voted: 8/12 Accepted`), and a primary
 * **1-1 Continuation Request** CTA that unlocks once the preset group sessions end.
 *
 * Presentation-only + THIN: sub-groups/vote/preset-ended are the SSR/seam-derived
 * {@link GroupSessionData}; the continuation request is stubbed until the live backend owns it.
 */

export interface GroupSessionPanelProps {
	detail: ProjectDetail;
	/** The SSR/seam-derived group projection (sub-groups · reschedule vote · preset-ended flag). */
	data: GroupSessionData;
	/** Which accordion groups are expanded (keyed `general|subgroups|dms`). */
	openGroups: Record<string, boolean>;
	onToggleGroup: (key: string) => void;
	/** Trigger a 1-1 Continuation Request (stub until the live backend). */
	onContinuation: () => void;
}

/** A sub-group channel row — a `#` channel with a proficiency tag + an overlap indicator. */
function SubGroupRow({ group, slug }: { group: SubGroup; slug: string }): JSX.Element {
	return (
		<a
			class="proj-chan proj-chan--subgroup"
			href={channelHref(slug, group.id)}
			data-joined={group.joined ? "true" : "false"}
		>
			<span class="proj-chan__glyph" aria-hidden="true">{HashIcon}</span>
			<span class="proj-chan__name">{group.name}</span>
			<span class="sess-tag" data-level={group.level.toLowerCase()}>{group.level}</span>
			{group.overlapping && (
				<Tooltip content="Overlapping schedule" placement="top">
					<span class="proj-chan__overlap" role="img" aria-label="Overlapping schedule">
						{OverlapIcon}
					</span>
				</Tooltip>
			)}
			{group.unread && <span class="proj-chan__dot" role="status" aria-label="unread" />}
		</a>
	);
}

export function GroupSessionPanel(
	{ detail, data, openGroups, onToggleGroup, onContinuation }: GroupSessionPanelProps,
): JSX.Element {
	const { general, dms } = detail.channels;
	const projectDms = dms.filter((d) => d.hasProjectContext);
	const joined = data.subGroups.filter((g) => g.joined);
	const votePct = data.vote.total > 0
		? Math.round((data.vote.accepted / data.vote.total) * 100)
		: 0;
	const open = (key: string) => !!openGroups[key];

	return (
		<div class="proj-sess proj-sess--group">
			{/* Active sub-group tags (the tracks the viewer belongs to) */}
			{joined.length > 0 && (
				<section class="sess-tags" aria-label="Your sub-groups">
					<span class="sess-tags__label">
						<span class="sess-tags__icon" aria-hidden="true">{LevelsIcon}</span>
						Your tracks
					</span>
					<ul class="sess-tags__list">
						{joined.map((g) => (
							<li key={g.id} class="sess-tags__item">
								<span class="sess-tag" data-level={g.level.toLowerCase()}>{g.level}</span>
								<span class="sess-tags__name">{g.name}</span>
								{g.overlapping && (
									<Tooltip content="Overlapping schedule" placement="top">
										<span class="sess-tags__overlap" role="img" aria-label="Overlapping schedule">
											{OverlapIcon}
										</span>
									</Tooltip>
								)}
							</li>
						))}
					</ul>
				</section>
			)}

			{/* Live reschedule vote */}
			<section class="sess-vote" aria-label="Reschedule vote">
				<div class="sess-vote__head">
					<span class="sess-vote__icon" aria-hidden="true">{PollIcon}</span>
					<span class="sess-vote__title">Reschedule proposal</span>
					<span class="sess-vote__tally">{data.vote.accepted}/{data.vote.total}</span>
				</div>
				<p class="sess-vote__prompt">{data.vote.prompt}</p>
				<div
					class="sess-vote__track"
					role="progressbar"
					aria-valuenow={votePct}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-label="Votes accepted"
				>
					<span class="sess-vote__fill" style={`inline-size:${votePct}%`} />
				</div>
				<span class="sess-vote__result">{data.vote.accepted} of {data.vote.total} accepted</span>
			</section>

			{/* Channel tree — General · Sub-groups · Private messages */}
			<LaneSections class="sess-tree">
				<AccordionGroup
					id="general"
					icon={HashIcon}
					label="General"
					open={open("general")}
					onToggle={() => onToggleGroup("general")}
					hasUnread={general.some((c) => c.unread)}
				>
					{general.map((c) => <ChannelRow key={c.id} channel={c} slug={detail.slug} />)}
				</AccordionGroup>

				<AccordionGroup
					id="subgroups"
					icon={LevelsIcon}
					label="Sub-groups"
					open={open("subgroups")}
					onToggle={() => onToggleGroup("subgroups")}
					hasUnread={data.subGroups.some((g) => g.unread)}
				>
					{data.subGroups.map((g) => <SubGroupRow key={g.id} group={g} slug={detail.slug} />)}
				</AccordionGroup>

				<AccordionGroup
					id="dms"
					icon={DmIcon}
					label="Private Messages"
					open={open("dms")}
					onToggle={() => onToggleGroup("dms")}
					hasUnread={projectDms.some((d) => d.unread)}
				>
					{projectDms.length === 0
						? <p class="proj-chan-empty">No cohort messages yet.</p>
						: projectDms.map((dm) => <DmRow key={dm.chatId} dm={dm} slug={detail.slug} />)}
				</AccordionGroup>
			</LaneSections>

			{/* 1-1 Continuation Request — unlocks once the preset sessions end */}
			<section class="sess-continue" data-ready={data.presetEnded ? "true" : undefined}>
				<div class="sess-continue__head">
					<span class="sess-continue__icon" aria-hidden="true">{ContinuationIcon}</span>
					<span class="sess-continue__title">Continue one-to-one</span>
				</div>
				<p class="sess-continue__note">
					{data.presetEnded
						? "Your preset group sessions have ended. Request private 1-1 sessions to keep going."
						: "Available once the cohort's preset group sessions finish."}
				</p>
				<button
					type="button"
					class="sess-continue__cta"
					disabled={!data.presetEnded}
					onClick={onContinuation}
				>
					Request 1-1 continuation
				</button>
			</section>
		</div>
	);
}
