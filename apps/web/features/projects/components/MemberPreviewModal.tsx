import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Dialog, Skeleton } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ProfileView } from "@projective/types/profile";
import type { MemberInvite, MemberRequest, ProjectMemberRow } from "../types/projects-types.ts";
import { ATTENDANCE_META, INVITE_STATUS_META, roleMeta } from "../core/member-model.ts";
import type { MemberContext } from "../core/member-sections.ts";
import type { ChatTarget } from "../core/member-chat.ts";
import { profileHref } from "../core/routing.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { AuthorityMark } from "./MemberBadges.tsx";
import {
	inviteePerson,
	RequestDecision,
	requestTarget,
	rosterFacts,
} from "./MemberSectionCards.tsx";

/**
 * MemberPreviewModal — the condensed profile a plain click on a roster card opens: who this person is
 * on THIS engagement (their role, stages, workload — or what they applied or were invited for) above
 * the public half of their profile (headline, base, languages, response time, standing, skills),
 * fetched when the preview opens. The header carries "View full profile" as an icon-only ghost link,
 * so the full page is one click (or a middle-click into a new tab) away; the footer carries Message
 * and, for a request, the same Accept/Reject the card offers.
 *
 * Text, not chips: every fact is a labelled line in the meta register (DESIGN_SYSTEM §B.11). A person
 * with no platform profile (an email-only invitee) previews from the roster facts alone, and so does
 * one whose profile read fails — the full profile is still one link away, and the read is retried
 * the next time the preview opens.
 */
export type PreviewSubject =
	| { kind: "member"; member: ProjectMemberRow }
	| { kind: "request"; request: MemberRequest }
	| { kind: "invite"; invite: MemberInvite };

/** Where the subject's public profile read stands. */
export type ProfileLoad =
	| { state: "idle" }
	| { state: "loading" }
	| { state: "loaded"; profile: ProfileView }
	| { state: "error" };

export interface MemberPreviewModalProps {
	open: Signal<boolean>;
	subject: PreviewSubject | null;
	context: MemberContext;
	showWorkload: boolean;
	load: ProfileLoad;
	/** A decision on the previewed request is in flight. */
	busy: boolean;
	/** The managing viewer's Stages section for a member subject; replaces the plain stages line. */
	stagePanel?: JSX.Element | null;
	onMessage: (target: ChatTarget) => void;
	onAccept: (request: MemberRequest) => void;
	onReject: (request: MemberRequest) => void;
	onClose: () => void;
}

interface Identity {
	name: string;
	handle: string | null;
	avatar: string | null;
	entity: boolean;
}

function identityOf(subject: PreviewSubject): Identity {
	switch (subject.kind) {
		case "member":
			return { ...subject.member.party, entity: false };
		case "request":
			return { ...subject.request.applicant, entity: subject.request.applicantKind === "team" };
		case "invite":
			return { ...inviteePerson(subject.invite), entity: false };
	}
}

/** The engagement facts, as `[label, value]` lines. */
function engagementFacts(
	subject: PreviewSubject,
	context: MemberContext,
	showWorkload: boolean,
	stagesShown: boolean,
): [string, string][] {
	switch (subject.kind) {
		case "member": {
			const m = subject.member;
			const lines: [string, string][] = [["Role", roleMeta(m.role).label]];
			const facts = stagesShown ? [] : rosterFacts(m, context);
			if (facts.length > 0) {
				lines.push([context.stageChannel ? "On this stage" : "Stages", facts.join(" · ")]);
			}
			if (context.session && m.attendance) {
				lines.push(["Attendance", ATTENDANCE_META[m.attendance].label]);
			}
			if (showWorkload) {
				lines.push([
					"Workload",
					m.openTickets > 0 ? `${m.openTickets} open tickets` : "No open tickets",
				]);
			}
			lines.push(["Joined", m.joinedLabel]);
			if (m.email) lines.push(["Email", m.email]);
			return lines;
		}
		case "request": {
			const r = subject.request;
			return [
				["Applied for", requestTarget(r)],
				["Applying as", r.applicantKind === "team" ? "A team" : "A freelancer"],
				["Applied", r.appliedLabel],
			];
		}
		case "invite": {
			const inv = subject.invite;
			return [
				["Status", INVITE_STATUS_META[inv.status].label],
				["Invited as", roleMeta(inv.role).label],
				["For", inv.stageName ?? "The whole project"],
				["Invited", `${inv.invitedLabel} by ${inv.invitedBy}`],
			];
		}
	}
}

/** The public profile facts worth a glance, as `[label, value]` lines. */
function profileFacts(profile: ProfileView): [string, string][] {
	const lines: [string, string][] = [];
	const base = [profile.location.city, profile.location.country].filter(Boolean).join(", ");
	if (base) lines.push(["Based in", base]);
	if (profile.languages.length > 0) {
		lines.push(["Speaks", profile.languages.map((l) => l.label).join(" · ")]);
	}
	if (profile.responseTime) lines.push(["Responds", profile.responseTime]);
	if (profile.stats.standing) lines.push(["Standing", profile.stats.standing.label]);
	if (profile.skills.length > 0) {
		lines.push(["Skills", profile.skills.slice(0, 6).map((s) => s.label).join(" · ")]);
	}
	return lines;
}

function FactList({ lines }: { lines: [string, string][] }): JSX.Element {
	return (
		<dl class="mem-preview__facts">
			{lines.map(([label, value]) => (
				<div class="mem-preview__fact" key={label}>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			))}
		</dl>
	);
}

export function MemberPreviewModal(props: MemberPreviewModalProps): JSX.Element {
	const { subject, load } = props;
	const who = subject ? identityOf(subject) : null;
	const handle = who?.handle?.replace(/^@+/, "") ?? null;
	const role = subject?.kind === "member" ? subject.member.role : undefined;
	const profile = load.state === "loaded" ? load.profile : null;

	const header = (
		<div class="mem-preview__head">
			<span class="mem-preview__title">
				{who?.name ?? "Profile"}
				{role && <AuthorityMark role={role} />}
			</span>
			{handle && (
				<a
					class="mem-preview__full"
					href={profileHref(handle)}
					aria-label="View full profile"
					title="View full profile"
				>
					<Icon name="external-link" size="sm" />
				</a>
			)}
		</div>
	);

	const footer = subject && who
		? (
			<div class="mem-dialog__foot">
				{handle && (
					<Button
						variant="outlined"
						severity="secondary"
						size="sm"
						icon={<Icon name="message" size="sm" />}
						label="Message"
						onClick={() => props.onMessage({ name: who.name, handle, avatar: who.avatar })}
					/>
				)}
				{subject.kind === "request" && (
					<RequestDecision
						request={subject.request}
						busy={props.busy}
						onAccept={props.onAccept}
						onReject={props.onReject}
					/>
				)}
			</div>
		)
		: undefined;

	return (
		<Dialog
			visible={props.open}
			header={header}
			footer={footer}
			width="30rem"
			class="mem-dialog mem-preview"
			onVisibleChange={(v) => !v && props.onClose()}
		>
			{subject && who && (
				<div class="mem-preview__body">
					<div class="mem-preview__who">
						{who.entity
							? <Avatar image={who.avatar} label={who.name} alt="" size="lg" shape="square" />
							: <UserAvatar image={who.avatar} label={who.name} alt="" size="lg" />}
						<div class="mem-preview__whotext">
							{handle && <span class="mem-preview__handle">@{handle}</span>}
							{profile?.headline
								? <p class="mem-preview__headline">{profile.headline}</p>
								: load.state === "loading"
								? <Skeleton shape="text" width="14rem" />
								: null}
						</div>
					</div>

					<FactList
						lines={engagementFacts(
							subject,
							props.context,
							props.showWorkload,
							subject.kind === "member" && !!props.stagePanel,
						)}
					/>

					{subject.kind === "member" && props.stagePanel}

					{subject.kind === "request" && subject.request.message && (
						<blockquote class="mem-preview__note">{subject.request.message}</blockquote>
					)}

					{load.state === "loading" && <Skeleton shape="text" lines={3} />}
					{profile && profileFacts(profile).length > 0 && (
						<section class="mem-preview__section" aria-label="Public profile">
							<h3 class="mem-preview__label">On their profile</h3>
							<FactList lines={profileFacts(profile)} />
						</section>
					)}
				</div>
			)}
		</Dialog>
	);
}
