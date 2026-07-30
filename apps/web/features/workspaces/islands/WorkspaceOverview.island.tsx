import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import { Tooltip } from "@projective/ui/feedback";
import { styleVars } from "@ui/core/style.ts";
import {
	activeMembers,
	kindCopy,
	setupProgress,
	type WorkspaceDetail,
	workspaceHref,
} from "@projective/types/workspace";
import { publishDetail } from "../core/workspace-state.ts";
import { countLabel } from "../core/workspace-model.ts";
import { EntityMark } from "../components/EntityMark.tsx";
import { SetupChecklist } from "../components/SetupChecklist.tsx";
import { StatTile } from "../components/StatTile.tsx";
import { ProjectList } from "../components/ProjectList.tsx";
import { ActivityFeed } from "../components/ActivityFeed.tsx";
import { FinanceSummary } from "../components/FinanceSummary.tsx";
import { VerificationLock } from "../components/VerificationLock.tsx";
import {
	cloneGlyph,
	InviteGlyph,
	MembersGlyph,
	ProjectsGlyph,
	StandingGlyph,
} from "../core/workspace-glyphs.tsx";

/**
 * WorkspaceOverview — the entity's home, for both kinds.
 *
 * It answers, top to bottom: who is this, is anything blocking me, what needs me, and how are we
 * doing. Everything that differs between a team and a business is a lookup in the SSOT's per-kind copy
 * table or a capability check — there is no `kind === "team" ? <TeamOverview/> : <BusinessOverview/>`
 * anywhere, because that fork is exactly how the two sides drift into different products.
 *
 * **Two gates behave differently, on purpose.** A capability the viewer lacks makes its band ABSENT —
 * a member with no finance rights is not shown a greyed-out vault teasing them. Verification is the
 * opposite: the band RENDERS AND LOCKS, because hiding the path to getting paid means nobody ever
 * finds it, whereas locking it teaches that it exists and what clears it.
 *
 * **A one-person team gets an honest pre-state, not a scold.** It is a legal entity that simply cannot
 * bid yet (`canPropose === false`), so the band names the gap and offers the fix rather than treating a
 * solo team as a mistake.
 */

export interface WorkspaceOverviewProps {
	workspace: WorkspaceDetail;
	/** Server-resolved reference year, so an SSR date and its hydration agree across a New Year. */
	referenceYear?: number;
}

export default function WorkspaceOverview(props: WorkspaceOverviewProps): JSX.Element {
	const detail = props.workspace;
	const copy = kindCopy(detail.kind);
	const held = new Set(detail.viewerCapabilities);

	/** Session-local dismissal — the checklist should not nag once waved off in this sitting. */
	const checklistDismissed = useSignal(false);

	// Publish the SSR detail so the lane, header band and footer rig read ONE projection rather than
	// each fetching their own and disagreeing about, say, how many members there are.
	useEffect(() => {
		publishDetail(detail);
	}, [detail.id, detail.members.length, detail.viewerCapabilities.length]);

	const members = useComputed(() => activeMembers(detail.members));
	const progress = setupProgress(detail.setup);
	const showChecklist = progress < 1 && !checklistDismissed.value;

	const openProjects = detail.projects.filter((p) => p.state === "active");
	const proposals = detail.projects.filter((p) => p.state === "proposal");
	const canSeeMoney = held.has("manage_finances") || held.has("spend_funds") ||
		held.has("withdraw_funds");
	const canInvite = held.has("invite_members");

	/** Band order, so the entrance stagger reads top-to-bottom regardless of which bands render. */
	let band = 0;
	const next = () => styleVars({ "--wsp-i": band++ });

	return (
		<div class="wsp" data-kind={detail.kind}>
			<div class="wsp__stack">
				{/* #region Identity */}
				<section
					class="wsp-band wsp-band--head"
					style={next()}
					aria-label={`${detail.name} header`}
				>
					<div class="wsp-band__inner">
						<div class="wsp-idhead">
							{detail.banner && (
								<div class="wsp-idhead__banner">
									<img
										class="wsp-idhead__banner-img"
										src={detail.banner}
										alt=""
										loading="lazy"
										decoding="async"
									/>
								</div>
							)}
							<div class="wsp-idhead__row">
								<EntityMark
									class="wsp-idhead__mark"
									kind={detail.kind}
									name={detail.name}
									handle={detail.handle}
									image={detail.avatar}
									size="lg"
								/>
								<div class="wsp-idhead__ident">
									<h1 class="wsp-idhead__name">{detail.name}</h1>
									{/* The handle resolves to the canonical public profile, never a console page. */}
									<a class="wsp-idhead__handle" href={`/@${detail.handle}`}>@{detail.handle}</a>
									{detail.tagline && <p class="wsp-idhead__tagline">{detail.tagline}</p>}
								</div>
								<div class="wsp-idhead__badges">
									{detail.isActing && (
										<Tooltip
											content={`Everything you do right now is on behalf of ${detail.name}`}
											placement="bottom"
										>
											<span class="wsp-actingchip">
												<span class="wsp-actingchip__dot" aria-hidden="true" />
												Acting as this {copy.noun}
											</span>
										</Tooltip>
									)}
									{detail.standing && (
										<Tooltip content="Earned standing — it cannot be bought" placement="bottom">
											<span class="wsp-capchip">
												<span aria-hidden="true">{cloneGlyph(StandingGlyph)}</span>
												{detail.standing}
											</span>
										</Tooltip>
									)}
								</div>
							</div>
							<div class="wsp-idhead__meta">
								<span class="wsp-idhead__metaitem">
									<span aria-hidden="true">{cloneGlyph(MembersGlyph)}</span>
									{countLabel(detail.kind, members.value.length)}
								</span>
								<span class="wsp-idhead__metaitem">
									<span aria-hidden="true">{cloneGlyph(ProjectsGlyph)}</span>
									{openProjects.length} active
								</span>
							</div>
						</div>
					</div>
				</section>
				{/* #endregion */}

				{
					/*
					 * Verification LOCKS rather than hides — see the module header. `VerificationLock` returns
					 * null once verified, so this costs nothing in the settled state.
					 */
				}
				<VerificationLock
					kind={detail.kind}
					verification={detail.verification}
					prompt={detail.verificationPrompt}
					href={workspaceHref(detail.kind, detail.id, "verification")}
					canManage={held.has("manage_settings")}
					tone="band"
				/>

				{showChecklist && (
					<section
						class="wsp-band wsp-band--checklist"
						style={next()}
						aria-label="Finish setting up"
					>
						<div class="wsp-band__inner">
							<SetupChecklist
								kind={detail.kind}
								workspaceId={detail.id}
								name={detail.name}
								handle={detail.handle}
								steps={detail.setup}
								isActing={detail.isActing}
								onDismiss={() => {
									checklistDismissed.value = true;
								}}
							/>
						</div>
					</section>
				)}

				{
					/*
					 * The >=2-members proposal rule, stated as a pre-state. A one-person team is legal; it just
					 * cannot bid. Naming the gap and offering the fix beats blocking creation (brief §12B (d)).
					 */
				}
				{detail.kind === "team" && !detail.canPropose && (
					<section class="wsp-band wsp-band--plain" style={next()}>
						<div class="wsp-band__inner">
							<p class="wsp-propose">
								<span class="wsp-propose__glyph" aria-hidden="true">{cloneGlyph(InviteGlyph)}</span>
								<span class="wsp-propose__text">
									A team needs at least two members before it can send proposals. Everything else
									here works now — this only gates bidding as a team.
								</span>
								{canInvite && (
									<a
										class="wsp-propose__link"
										href={workspaceHref(detail.kind, detail.id, "members")}
									>
										Invite someone
									</a>
								)}
							</p>
						</div>
					</section>
				)}

				{/* #region At a glance */}
				<section class="wsp-band wsp-band--stats" style={next()} aria-label="At a glance">
					<div class="wsp-band__inner">
						<div class="wsp-tiles">
							<StatTile
								label="Members"
								value={String(members.value.length)}
								caption={detail.invites.length > 0
									? `${detail.invites.length} awaiting a decision`
									: "Everyone is settled"}
								icon={cloneGlyph(MembersGlyph)}
							/>
							<StatTile
								label="Active projects"
								value={String(openProjects.length)}
								caption={detail.kind === "team" ? "In delivery" : "Commissioned"}
								icon={cloneGlyph(ProjectsGlyph)}
							/>
							{proposals.length > 0 && (
								<StatTile
									label="Proposals out"
									value={String(proposals.length)}
									caption="Awaiting a reply"
								/>
							)}
						</div>
					</div>
				</section>
				{/* #endregion */}

				{/* Money is ABSENT for a viewer without finance rights — see the module header. */}
				{canSeeMoney && (
					<section class="wsp-band wsp-band--money" style={next()} aria-label="Money">
						<div class="wsp-band__inner">
							<div class="wsp-band__head">
								<h2 class="wsp-band__title">Money</h2>
							</div>
							<div class="wsp-band__body">
								<FinanceSummary kind={detail.kind} finance={detail.finance} />
							</div>
						</div>
					</section>
				)}

				<section class="wsp-band wsp-band--projects" style={next()} aria-label="Projects">
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">
								{detail.kind === "team" ? "Delivering" : "Commissioned"}
							</h2>
							<a
								class="wsp-band__action"
								href={workspaceHref(detail.kind, detail.id, "projects")}
							>
								All projects
							</a>
						</div>
						<div class="wsp-band__body">
							<ProjectList projects={detail.projects} kind={detail.kind} limit={5} />
						</div>
					</div>
				</section>

				<section
					class="wsp-band wsp-band--activity wsp-band--tail"
					style={next()}
					aria-label="Recent activity"
				>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">Recent activity</h2>
						</div>
						<div class="wsp-band__body">
							<ActivityFeed entries={detail.activity} limit={8} />
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}
