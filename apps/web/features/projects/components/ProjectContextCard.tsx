import type { JSX } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import {
	type EngagementArchetype,
	engagementArchetype,
	engagementTypeLabel,
} from "@projective/types/projects";
import { archetypeIcon } from "./detail-glyphs.tsx";
import { profileHref } from "../core/routing.ts";
import type { ProjectDetail } from "../types/projects-types.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * The type the header names and badges, from the stored axes alone. The engagement's `kind` only says
 * who architected it, so a pipeline instantiated from a service reads "Pipeline service", never the
 * calendar a session would carry. A Task has no board, so it takes the glyph the create menu offers it under.
 */
function typeMark(detail: ProjectDetail): {
	archetype: EngagementArchetype;
	label: string;
	icon: JSX.Element;
} {
	const archetype = engagementArchetype(detail.format, detail.structure);
	return {
		archetype,
		label: engagementTypeLabel(archetype, detail.kind),
		icon: archetype === "task" ? <Icon name="ticket" /> : archetypeIcon(archetype),
	};
}

/**
 * ProjectContextCard — the card-LESS identity header of the Project Details sidebar. It no longer sits
 * inside a tonal box; the elements rest directly on the lane surface and are set off from the channel
 * tree below by a single hairline divider (rendered by the island), keeping the region borderless per
 * the §B.4 separation hierarchy.
 *
 * Layout: the leading party's LARGE avatar on the left (a **project** leads with its owner, a
 * **service** with the client it's delivered for), the engagement's name + a single clickable
 * owner/client name stacked to its right. The engagement type (Pipeline · One-off · Session · Task) is
 * named in an uppercase meta line above the name, and its glyph sits as a small filled badge on the
 * avatar's bottom-right corner, tinted by the type's role pair. Beneath sits the description, clamped
 * to three lines with an in-place **Show details** disclosure.
 *
 * Decision #144 changed two things. The name is a paragraph, not an `<h1>`: the page beside the lane
 * owns the document's one title, and two level-one headings told assistive technology the page was
 * about two things. And the description no longer links to the engagement's root — the root is now
 * the Overview, so "Show details" would have promised the brief and opened a dashboard; it reveals
 * the words in place instead. The disclosure is drawn only while the text is actually clamped, so it
 * never toggles nothing (root CLAUDE.md §3 gate 11).
 *
 * Rendered only inside the `ProjectSidebar` island, so its one piece of state is a local signal.
 */
export interface ProjectContextCardProps {
	detail: ProjectDetail;
}

export function ProjectContextCard({ detail }: ProjectContextCardProps): JSX.Element {
	const isService = detail.kind === "service";
	// A project leads with its owner; a service leads with the client. Fall back to the owner so the
	// header always has an identity even for a client-less internal draft.
	const lead = (isService ? detail.client : detail.owner) ?? detail.owner;
	const board = typeMark(detail);
	const typeTip = board.label;

	const expanded = useSignal(false);
	// Optimistically `true` so the server render keeps the line it always had; the first measurement
	// after hydration withdraws the control when three lines already hold the whole description.
	const clamped = useSignal(true);
	const textRef = useRef<HTMLParagraphElement>(null);
	const textId = useId();

	useEffect(() => {
		const el = textRef.current;
		if (!el || expanded.value) return;
		clamped.value = el.scrollHeight > el.clientHeight + 1;
	}, [detail.description]);

	return (
		<header class="proj-ctx" data-kind={detail.kind} aria-label={`${typeTip} overview`}>
			<div class="proj-ctx__top">
				<span class="proj-ctx__avatar">
					<UserAvatar
						image={lead.avatar ?? undefined}
						label={lead.name}
						size={48}
						shape="circle"
					/>
					{/* Decorative: the type line beside it already names the type. */}
					<span class="proj-ctx__type" data-type={board.archetype} aria-hidden="true">
						{board.icon}
					</span>
				</span>

				<div class="proj-ctx__idblock">
					<p class="proj-ctx__kind">{typeTip}</p>
					<p class="proj-ctx__title">{detail.title}</p>
					{lead.handle
						? (
							<a
								class="proj-ctx__owner-name"
								href={profileHref(lead.handle)}
								aria-label={`View ${lead.name}'s profile`}
							>
								{lead.name}
							</a>
						)
						: (
							<span class="proj-ctx__owner-name proj-ctx__owner-name--static">
								{lead.name}
							</span>
						)}
				</div>
			</div>

			{detail.description && (
				<div class="proj-ctx__desc" data-expanded={expanded.value ? "true" : undefined}>
					<p class="proj-ctx__desc-text" id={textId} ref={textRef}>{detail.description}</p>
					{(clamped.value || expanded.value) && (
						<button
							type="button"
							class="proj-ctx__show"
							aria-expanded={expanded.value ? "true" : "false"}
							aria-controls={textId}
							onClick={() => (expanded.value = !expanded.value)}
						>
							{expanded.value ? "Show less" : "Show details"}
						</button>
					)}
				</div>
			)}
		</header>
	);
}
