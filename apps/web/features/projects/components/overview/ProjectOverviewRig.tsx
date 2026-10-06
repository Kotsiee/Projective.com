import type { JSX } from "preact";
import type { ProjectWorkspace } from "@projective/types/projects";
import { projectHref } from "../../core/project-access.ts";

/**
 * The Overview's middle-nav FOOTER band (Decision #144): at most one filled and one outlined control,
 * and a line saying when the engagement last moved.
 *
 *   • **Filled** — the first row of "Needs you", the most pressing thing on the page, so the band and
 *     the page name the same next step. With nothing pending it is "Open discussion", the engagement's
 *     one shared room.
 *   • **Outlined** — the owner's "Invite people" (the Members page's invitations, where the invite
 *     action lives); a participant's "Open discussion" when the filled control is an action. On a
 *     phone-width band it steps aside, so the filled control's label reads whole instead of both
 *     truncating; its destination is still one tap away in the lane.
 *
 * No kebab: the lane header's More actions already carries Open · Share · Archive (Decision #140), and
 * an action gets one home. And never Apply — the people who reach the Overview are already on the
 * engagement; Apply lives on the public listing.
 *
 * Every control is a real `<a href>` drawn in the button classes (the established pattern for a link
 * that reads as a command), so the rig needs no island and works before hydration.
 */
export interface ProjectOverviewRigProps {
	slug: string;
	workspace: ProjectWorkspace;
	/** Whether the engagement has its discussion room — the fallback command links it only if so. */
	discussion: boolean;
}

interface RigLink {
	label: string;
	href: string;
}

export function ProjectOverviewRig(
	{ slug, workspace, discussion }: ProjectOverviewRigProps,
): JSX.Element {
	const top = workspace.nextActions[0] ?? null;
	const room: RigLink | null = discussion
		? { label: "Open discussion", href: projectHref(slug, "discussion") }
		: null;
	const primary: RigLink | null = top ? { label: top.label, href: top.href } : room;
	const secondary: RigLink | null = workspace.viewer === "owner"
		? { label: "Invite people", href: `${projectHref(slug, "members")}?view=invitations` }
		: top
		? room
		: null;
	const latest = workspace.updates[0] ?? null;

	return (
		<div class="pjd-rig">
			<p class="pjd-rig__meta">
				{latest ? `Last activity · ${latest.atLabel}` : "No activity yet"}
			</p>
			<div class="pjd-rig__actions">
				{secondary && (
					<a
						class="ui-button ui-button--secondary ui-button--outlined ui-button--size-md ui-button--rounded pjd-rig__secondary"
						href={secondary.href}
					>
						<span class="ui-button__label">{secondary.label}</span>
					</a>
				)}
				{primary && (
					<a
						class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded"
						href={primary.href}
					>
						<span class="ui-button__label">{primary.label}</span>
					</a>
				)}
			</div>
		</div>
	);
}
