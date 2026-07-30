import type { JSX, VNode } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import type { ActivityEntry } from "@projective/types/workspace";
import {
	ApproveGlyph,
	cloneGlyph,
	MembersGlyph,
	ProjectsGlyph,
	RoleGlyph,
	SettingsGlyph,
	WalletGlyph,
} from "../core/workspace-glyphs.tsx";

/**
 * ActivityFeed — the overview's "what has happened here" list.
 *
 * Each line answers one question in one glance: what kind of thing happened (the leading glyph), who
 * did it (a circular avatar — people are round, entities are square), what it was, and when. The kind
 * is carried by the GLYPH rather than a coloured badge or a word, so a reader scanning for money
 * movement can find it without reading a single sentence (§B.6).
 *
 * Rows are separated tonally and by spacing, never boxed (§B.4): a feed of forty bordered cards is a
 * ransom note. A row that has somewhere to go is a real anchor so it can be opened in a new tab.
 */

/** The glyph per activity kind. Kept beside the component so a new kind cannot ship unillustrated. */
const KIND_GLYPH: Record<ActivityEntry["kind"], VNode> = {
	member: MembersGlyph,
	project: ProjectsGlyph,
	money: WalletGlyph,
	role: RoleGlyph,
	listing: ApproveGlyph,
	system: SettingsGlyph,
};

/** What the glyph means, for its tooltip — the words live here, not in the row (§B.6). */
const KIND_LABEL: Record<ActivityEntry["kind"], string> = {
	member: "Membership",
	project: "Project",
	money: "Money",
	role: "Roles and permissions",
	listing: "Listing",
	system: "System",
};

export interface ActivityFeedProps {
	entries: readonly ActivityEntry[];
	/** Cap the list; the overview shows a recent window rather than the whole history. */
	limit?: number;
	/** Rendered when there is nothing yet. A brand-new entity has an empty feed by definition. */
	empty?: VNode | null;
}

/** The overview's recent-activity list. */
export function ActivityFeed(props: ActivityFeedProps): JSX.Element {
	const entries = props.limit ? props.entries.slice(0, props.limit) : props.entries;

	if (entries.length === 0) {
		return (
			<div class="wsp-activity">
				{props.empty ?? (
					<p class="wsp-activity__text">
						Nothing has happened here yet — activity will appear as people join and work starts.
					</p>
				)}
			</div>
		);
	}

	return (
		<ul class="wsp-activity" aria-label="Recent activity">
			{entries.map((entry) => {
				const glyph = KIND_GLYPH[entry.kind];
				const body = (
					<span class="wsp-activity__body">
						<span class="wsp-activity__text">{entry.text}</span>
						<span class="wsp-activity__at">
							{entry.actor && <span class="wsp-activity__actor">{entry.actor}</span>}
							{entry.actor ? " · " : ""}
							{entry.at}
						</span>
					</span>
				);

				return (
					<li class="wsp-activity__item" key={entry.id}>
						<span class="wsp-activity__row">
							<Tooltip content={KIND_LABEL[entry.kind]} placement="right">
								<span class="wsp-activity__glyph" aria-label={KIND_LABEL[entry.kind]} role="img">
									{cloneGlyph(glyph)}
								</span>
							</Tooltip>
							{entry.actorAvatar && (
								<Avatar
									class="wsp-activity__avatar"
									image={entry.actorAvatar}
									alt=""
									label={entry.actor ?? undefined}
									shape="circle"
									size="sm"
								/>
							)}
							{entry.href ? <a class="wsp-activity__link" href={entry.href}>{body}</a> : body}
						</span>
					</li>
				);
			})}
		</ul>
	);
}
