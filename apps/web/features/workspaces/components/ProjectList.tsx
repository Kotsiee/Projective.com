import type { JSX, VNode } from "preact";
import { styleVars } from "@ui/core/style.ts";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { kindCopy, type WorkspaceKind, type WorkspaceProject } from "@projective/types/workspace";
import { cloneGlyph, ProjectsGlyph } from "../core/workspace-glyphs.tsx";

/**
 * ProjectList — the engagements band: what the entity is delivering (team) or has commissioned
 * (business).
 *
 * ## One list, both kinds
 *
 * A team's deliveries and a business's commissions render through the same rows. The only real difference
 * is which side of the market the counterparty sits on, and that is a *data* question the server already
 * answered (`WorkspaceProject.counterparty`) — so the kind changes a preposition and nothing else. Forking
 * this into two components would duplicate a layout to express a word.
 *
 * ## Status is iconographic (§B.6)
 *
 * The state is carried by the leading glyph's tone, and the *word* — the server's own `statusLabel` —
 * lives only in that glyph's portal `Tooltip`. No row prints a status sentence: a dense list where every
 * line ends in prose stops being scannable, and the eye is looking for the title anyway. The label is
 * also announced through the tooltip's `aria-describedby`, so nothing is colour-only.
 *
 * ## The progress fill is not animated
 *
 * `--wsp-progress` sets the fill's inline size directly (root CLAUDE.md §11). A frozen animation clock
 * must never be able to draw a 70%-complete engagement at zero, so the property that encodes the fact is
 * never the property that moves.
 */

// #region Copy
/** How the counterparty is introduced, per kind. A team delivers *for*; a business commissions *from*. */
function partyPreposition(kind: WorkspaceKind, state: WorkspaceProject["state"]): string {
	if (kind === "team") return state === "proposal" ? "Proposed to" : "For";
	return state === "proposal" ? "Proposal from" : "With";
}
// #endregion

// #region Rows
/** One engagement row. */
function ProjectRow({
	project,
	kind,
}: {
	project: WorkspaceProject;
	kind: WorkspaceKind;
}): JSX.Element {
	const pct = Math.round(Math.min(1, Math.max(0, project.progress)) * 100);

	return (
		<li class="wsp-projects__item">
			<a
				class="wsp-projects__row"
				href={project.href}
				data-state={project.state}
				style={styleVars({ "--wsp-progress": project.progress })}
			>
				{
					/*
					 * The glyph is the status. Its Tooltip carries the word, and the tooltip's `role="tooltip"`
					 * + `aria-describedby` wiring is what makes an icon-only signal accessible (§B.6 — never a
					 * native `title`).
					 */
				}
				<Tooltip content={project.statusLabel} placement="top">
					<span class="wsp-projects__glyph">{cloneGlyph(ProjectsGlyph)}</span>
				</Tooltip>

				<span class="wsp-projects__body">
					<span class="wsp-projects__title">{project.title}</span>
					<span class="wsp-projects__party">
						<Avatar
							image={project.counterpartyAvatar || undefined}
							label={project.counterparty}
							size={16}
							shape="circle"
							class="wsp-projects__party-avatar"
						/>
						<span class="wsp-projects__party-name">
							{partyPreposition(kind, project.state)} {project.counterparty}
						</span>
					</span>
				</span>

				<span class="wsp-projects__progress">
					<span class="wsp-projects__track" aria-hidden="true">
						<span class="wsp-projects__fill" />
					</span>
					<span class="wsp-projects__pct">{pct}%</span>
				</span>

				<span class="wsp-projects__due">{project.due ?? "No date set"}</span>

				{
					/*
					 * The one fact the row carries only as a colour. Everything else — the title, the
					 * counterparty, the percentage, the date — is already printed text inside this link, so
					 * repeating it here would double the link's accessible name for no gain.
					 */
				}
				<span class="ui-visually-hidden">Status: {project.statusLabel}.</span>
			</a>
		</li>
	);
}
// #endregion

// #region Component
export interface ProjectListProps {
	/** The engagements to render, in the server's order. */
	projects: readonly WorkspaceProject[];
	kind: WorkspaceKind;
	/** Cap the rows shown. The overview shows a handful and defers the rest to the Projects module. */
	limit?: number;
	/** Rendered when there are none — the caller supplies it so the copy can suit its own context. */
	empty?: VNode | null;
}

/**
 * The list. Rows are divided by a single hairline and are never boxed (§B.4); the hover tint is the only
 * decoration, and it belongs to the row because the whole row is the link.
 */
export function ProjectList(props: ProjectListProps): JSX.Element {
	const { projects, kind, limit } = props;
	const rows = limit === undefined ? projects : projects.slice(0, limit);

	if (rows.length === 0) {
		return props.empty ?? <EmptyProjects kind={kind} />;
	}

	return (
		<ul class="wsp-projects">
			{rows.map((project) => <ProjectRow key={project.id} project={project} kind={kind} />)}
		</ul>
	);
}
// #endregion

// #region Empty state
/**
 * No engagements yet.
 *
 * Stated as a stage rather than as a shortfall, and per kind — an unbid team and an unspent business are
 * at genuinely different points, and telling a brand-new business it has "no projects" as though that
 * were a problem would be scolding it for being new.
 */
function EmptyProjects({ kind }: { kind: WorkspaceKind }): JSX.Element {
	const copy = kindCopy(kind);
	return (
		<div class="wsp-blank">
			<p class="wsp-blank__text">
				{kind === "team" ? "No engagements yet." : "Nothing commissioned yet."}
			</p>
			<p class="wsp-blank__hint">
				{kind === "team"
					? `Work the ${copy.noun} wins or is invited to will appear here, with its stage and its next ` +
						"milestone."
					: `Projects and services this ${copy.noun} commissions will appear here, with their stage and ` +
						"next milestone."}
			</p>
		</div>
	);
}
// #endregion
