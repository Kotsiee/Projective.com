import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	kindCopy,
	type PermissionFacet,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { shortDate } from "../core/workspace-model.ts";
import {
	dossierDomains,
	dossierFacts,
	drawerTerminal,
	envelopeSection,
	type MemberAbilities,
	membersTierProps,
	reportingLine,
	roleText,
	showsStake,
} from "../core/members-model.ts";
import { ConsequenceIcon, PersonAvatar } from "./MemberCard.tsx";

/** Props for {@link MemberDetailPanel}. */
export interface MemberDetailPanelProps {
	workspace: WorkspaceDetail;
	member: WorkspaceMember;
	/** What the viewer may do to this member — the rank rule's answer. */
	abilities: MemberAbilities;
	/** The member's effective capabilities, from the SSOT's `permissionFacets()`. */
	facets: readonly PermissionFacet[];
	/** Distinguishes the docked and slide-over copies' ids. */
	idBase: string;
	onMessage: () => void;
	onEdit: () => void;
	/** Open someone on the reporting line in the inspector. */
	onSelect: (member: WorkspaceMember) => void;
	/** Ask for a terminal act — the Members body owns its confirmation. */
	onAct: (act: "transfer" | "leave" | "remove") => void;
}

/**
 * MemberDetailPanel — the member inspector's dossier (Decision #322): who this person is here, what
 * they may do, and where they sit, read before anything is changed.
 *
 * A head (48px avatar, name, handle · role · title, joined · workload · stake), the tier-4 quick
 * actions (Message, Edit member — each present only when the rank rule allows it), the reporting line
 * (the manager and the direct reports, each opening that person here), then the capabilities by
 * domain as a glyph-and-text list of what they hold. A sensitive capability carries its consequence
 * as inline warning text; an override on this person says so in the meta register.
 *
 * Every region is a section separated by spacing and a heading — no boxes inside the panel (§B.9.2),
 * no pills for metadata (§B.11).
 */
export function MemberDetailPanel(props: MemberDetailPanelProps): JSX.Element {
	const { workspace: ws, member, abilities, idBase } = props;
	const id = (part: string) => `${idBase}-${member.id}-${part}`;
	const line = reportingLine(ws.members, member);
	const domains = dossierDomains(props.facets, ws.kind);
	const envelope = envelopeSection(ws, member);
	const terminal = drawerTerminal(abilities, member, ws.kind);
	const facts = dossierFacts(
		member,
		ws.kind,
		showsStake(ws.kind, ws.viewerCapabilities),
		shortDate(member.joinedAt),
	);

	return (
		<div class="wsp-inspector__dossier">
			<header class="wsp-inspector__head">
				<PersonAvatar member={member} size={48} />
				<div class="wsp-inspector__ident">
					<h2 class="wsp-inspector__name" id={id("name")}>{member.name}</h2>
					<MetaLine
						size="sm"
						items={[
							`@${member.handle}`,
							member.isSelf && "You",
							roleText(member, ws.roles),
							member.title,
						]}
					/>
					<MetaLine size="xs" items={facts} />
				</div>
			</header>

			{(abilities.message || abilities.edit) && (
				<div class="wsp-inspector__quick">
					{abilities.message && (
						<Button
							{...membersTierProps(4)}
							size="sm"
							icon={<Icon name="message" />}
							label="Message"
							onClick={props.onMessage}
						/>
					)}
					{abilities.edit && (
						<Button
							{...membersTierProps(4)}
							size="sm"
							icon={<Icon name="edit" />}
							label="Edit member"
							onClick={props.onEdit}
						/>
					)}
				</div>
			)}

			<section class="wsp-inspector__section" aria-labelledby={id("line")}>
				<h3 class="wsp-inspector__heading" id={id("line")}>Reporting line</h3>
				<dl class="wsp-inspector__facts">
					<dt class="wsp-inspector__fact-label">Reports to</dt>
					<dd class="wsp-inspector__fact-value">
						{line.manager
							? (
								<span class="wsp-inspector__person">
									<PersonAvatar member={line.manager} size="sm" />
									<Button
										{...membersTierProps("link")}
										label={line.manager.name}
										onClick={() => line.manager && props.onSelect(line.manager)}
									/>
								</span>
							)
							: <span class="wsp-inspector__muted">Nobody — top of the chart</span>}
					</dd>
					<dt class="wsp-inspector__fact-label">
						Direct reports{line.reports.length > 0 && (
							<span class="wsp-inspector__count">{line.reports.length}</span>
						)}
					</dt>
					<dd class="wsp-inspector__fact-value">
						{line.reports.length === 0
							? <span class="wsp-inspector__muted">Nobody reports to {member.name}</span>
							: (
								<ul class="wsp-inspector__people">
									{line.reports.map((report) => (
										<li key={report.id} class="wsp-inspector__person">
											<PersonAvatar member={report} size="sm" />
											<Button
												{...membersTierProps("link")}
												label={report.name}
												onClick={() => props.onSelect(report)}
											/>
										</li>
									))}
								</ul>
							)}
					</dd>
				</dl>
			</section>

			<section class="wsp-inspector__section" aria-labelledby={id("caps")}>
				<h3 class="wsp-inspector__heading" id={id("caps")}>What they may do</h3>
				{domains.map((domain) => (
					<div
						key={domain.key}
						class="wsp-inspector__domain"
						role="group"
						aria-labelledby={id(`domain-${domain.key}`)}
					>
						<h4 class="wsp-inspector__domain-title" id={id(`domain-${domain.key}`)}>
							{domain.title}
						</h4>
						{domain.grants.length === 0
							? <p class="wsp-inspector__muted">Nothing in this area.</p>
							: (
								<ul class="wsp-inspector__grants">
									{domain.grants.map((grant) => (
										<li key={grant.capability} class="wsp-inspector__grant">
											<span class="wsp-inspector__grant-mark" aria-hidden="true">
												<Icon name="check" />
											</span>
											<span class="wsp-inspector__grant-body">
												<span class="wsp-inspector__grant-label">{grant.label}</span>
												{grant.granted && (
													<span class="wsp-inspector__grant-note">
														Granted to this person on top of their role
													</span>
												)}
												{grant.warning && (
													<span class="wsp-inspector__warning">
														<span class="wsp-inspector__warning-mark" aria-hidden="true">
															<ConsequenceIcon />
														</span>
														{grant.warning}
													</span>
												)}
											</span>
										</li>
									))}
								</ul>
							)}
						{domain.revoked.length > 0 && (
							<p class="wsp-inspector__grant-note">
								Revoked from this person: {domain.revoked.join(", ")}
							</p>
						)}
					</div>
				))}
			</section>

			{envelope && (
				<section class="wsp-inspector__section" aria-labelledby={id("envelope")}>
					<h3 class="wsp-inspector__heading" id={id("envelope")}>Spend envelope</h3>
					<MetaLine items={envelope.facts} />
					<p class="wsp-inspector__note">{envelope.note}</p>
					{envelope.link && (
						<a
							class="ui-button ui-button--primary ui-button--text ui-button--size-sm wsp-inspector__link"
							href={envelope.link.href}
						>
							<span class="ui-button__label">{envelope.link.label}</span>
						</a>
					)}
				</section>
			)}

			{terminal && (
				<section class="wsp-inspector__section wsp-inspector__terminal">
					<p class="wsp-inspector__note">{terminal.note}</p>
					<Button
						{...membersTierProps(terminal.tier, terminal.danger)}
						label={terminal.label}
						onClick={() => props.onAct(terminal.key)}
					/>
				</section>
			)}
			{!terminal && member.rolePreset === "owner" && !member.isSelf && (
				<p class="wsp-inspector__note">
					{member.name} owns this {kindCopy(ws.kind).noun}. Ownership changes only when they hand it
					over.
				</p>
			)}
		</div>
	);
}
