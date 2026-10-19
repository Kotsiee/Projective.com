import type { JSX, VNode } from "preact";
import { MetaLine } from "@projective/ui/display";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import type { ActivityRow } from "../core/overview-model.ts";
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
 * ActivityFeed — the Overview's "what has happened here", one event per row.
 *
 * Each row is the person (a round avatar — people are round, entities square), one sentence in the body
 * register, and a meta line of when and in which module. Rows part by ONE hairline and are never boxed or
 * chipped (§B.4, §B.11); an event with nowhere to go is plain text, one with a destination is a real
 * anchor. An event nobody performed (a system event) keeps the avatar's slot with its kind's glyph, so the
 * sentences stay aligned.
 */

/** The glyph an actor-less event shows in the avatar's slot. */
const KIND_GLYPH: Record<ActivityRow["kind"], VNode> = {
	member: MembersGlyph,
	project: ProjectsGlyph,
	money: WalletGlyph,
	role: RoleGlyph,
	listing: ApproveGlyph,
	system: SettingsGlyph,
};

export interface ActivityFeedProps {
	rows: readonly ActivityRow[];
}

/** One event. */
function ActivityItem({ row }: { row: ActivityRow }): JSX.Element {
	const body = (
		<>
			{row.actor
				? (
					<UserAvatar
						class="wsp-activity__avatar"
						image={row.avatar ?? undefined}
						alt=""
						label={row.actor}
						shape="circle"
						size="sm"
					/>
				)
				: (
					<span class="wsp-activity__mark" aria-hidden="true">
						{cloneGlyph(KIND_GLYPH[row.kind])}
					</span>
				)}
			<span class="wsp-activity__body">
				<span class="wsp-activity__text">{row.text}</span>
				<MetaLine as="span" size="xs" items={row.meta.map((text) => ({ text, tabular: true }))} />
			</span>
		</>
	);
	return (
		<li class="wsp-activity__item">
			{row.href
				? <a class="wsp-activity__row wsp-activity__row--link" href={row.href}>{body}</a>
				: <div class="wsp-activity__row">{body}</div>}
		</li>
	);
}

/** The feed, or one Meta line when nothing has happened yet. */
export function ActivityFeed(props: ActivityFeedProps): JSX.Element {
	if (props.rows.length === 0) {
		return <MetaLine class="wsp-activity__empty" items={["Nothing has happened here yet."]} />;
	}
	return (
		<ul class="wsp-activity">
			{props.rows.map((row) => <ActivityItem key={row.id} row={row} />)}
		</ul>
	);
}
