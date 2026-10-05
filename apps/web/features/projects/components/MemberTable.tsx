import type { ComponentChildren, JSX, VNode } from "preact";
import type { Signal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { styleVars } from "@ui/core/style.ts";
import type {
	MemberInvite,
	MemberPresence,
	MemberRequest,
	MemberRole,
	ProjectMemberRow,
} from "../types/projects-types.ts";
import { profileHref } from "../core/routing.ts";
import { roleMeta } from "../core/member-model.ts";
import type { MemberContext } from "../core/member-sections.ts";
import { isModifiedClick } from "@web/features/explore/core/routing.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import {
	AttendanceTag,
	AuthorityMark,
	InviteStatusTag,
	PresenceDot,
	RoleText,
} from "./MemberBadges.tsx";
import {
	InviteAction,
	inviteePerson,
	RequestDecision,
	requestTarget,
	rosterFacts,
} from "./MemberSectionCards.tsx";

/**
 * MemberTable — the list half of the zoom-driven roster: one real `<table>` per section, so a screen
 * reader gets row/column semantics and every sortable header is a button wiring `aria-sort`. The
 * headers drive the SAME sort signals as the toolbar's `SortControl` — one source of truth. Rows are
 * transparent with a single hairline and a hover tint (DESIGN_SYSTEM §B.4); their height follows the
 * zoom (`--mem-row-h`). The person cell's name is the row's link: a plain click opens the in-place
 * preview, a modified or middle click opens the full profile in a new tab.
 *
 * Presentation only; every action flows through the injected callbacks and slots.
 */

// #region Shared cells
interface SortHeaderProps {
	label: string;
	col: string;
	sortKey: Signal<string>;
	sortDir: Signal<"asc" | "desc">;
	onSort: (key: string) => void;
	class?: string;
}

function SortHeader(props: SortHeaderProps): JSX.Element {
	const active = props.sortKey.value === props.col;
	const dir = props.sortDir.value;
	return (
		<th
			scope="col"
			class={props.class}
			aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
		>
			<button
				type="button"
				class="mem-th"
				data-active={active ? "true" : undefined}
				onClick={() => props.onSort(props.col)}
			>
				<span>{props.label}</span>
				<span class="mem-th__caret" data-dir={active ? dir : undefined} aria-hidden="true">
					<Icon name="chevron-down" size="xs" />
				</span>
			</button>
		</th>
	);
}

interface PersonCellProps {
	name: string;
	handle: string | null;
	avatar: string | null;
	entity?: boolean;
	role?: MemberRole;
	presence?: MemberPresence;
	viewer?: boolean;
	onOpen: () => void;
}

/** The identity cell: avatar, the name as the row's link, the handle beneath. */
function PersonCell(props: PersonCellProps): JSX.Element {
	const handle = props.handle?.replace(/^@+/, "") ?? null;
	const youMark = !!props.viewer && props.name !== "You";
	function onClick(event: MouseEvent): void {
		if (isModifiedClick(event)) return;
		event.preventDefault();
		props.onOpen();
	}
	return (
		<div class="mem-person">
			<span class="mem-person__avatar">
				{props.entity
					? <Avatar image={props.avatar} label={props.name} alt="" size="md" shape="square" />
					: <UserAvatar image={props.avatar} label={props.name} alt="" size="md" />}
				{props.presence && <PresenceDot presence={props.presence} />}
			</span>
			<span class="mem-person__text">
				<span class="mem-person__line">
					{handle
						? (
							<a class="mem-person__name" href={profileHref(handle)} onClick={onClick}>
								{props.name}
							</a>
						)
						: <span class="mem-person__name">{props.name}</span>}
					{props.role && <AuthorityMark role={props.role} />}
				</span>
				{(handle || youMark) && (
					<span class="mem-person__handle">
						{handle ? `@${handle}` : null}
						{handle && youMark ? " · " : null}
						{youMark ? "You" : null}
					</span>
				)}
			</span>
		</div>
	);
}

/** Middot-joined facts as one muted cell, or a dash. */
function Facts({ facts }: { facts: readonly string[] }): JSX.Element {
	if (facts.length === 0) return <span class="mem-dash">—</span>;
	return (
		<span class="mem-facts">
			{facts.map((fact, i) => (
				<span key={fact}>
					{i > 0 && <span class="mem-dot" aria-hidden="true">·</span>}
					{fact}
				</span>
			))}
		</span>
	);
}

interface ListShellProps {
	label: string;
	rowHeight: number;
	head: ComponentChildren;
	children: ComponentChildren;
}

function ListShell(props: ListShellProps): JSX.Element {
	return (
		<div class="mem-list" style={styleVars({ "--mem-row-h": `${props.rowHeight}px` })}>
			<table class="mem-table" aria-label={props.label}>
				<thead>
					<tr>{props.head}</tr>
				</thead>
				<tbody>{props.children}</tbody>
			</table>
		</div>
	);
}

const ActionsHead = () => (
	<th scope="col" class="mem-col--actions">
		<span class="ui-visually-hidden">Actions</span>
	</th>
);
// #endregion

// #region Members
interface SortProps {
	sortKey: Signal<string>;
	sortDir: Signal<"asc" | "desc">;
	onSort: (key: string) => void;
	rowHeight: number;
}

/** The sort trio a header binds — never the whole table's props. */
function sortOf(props: SortProps): Pick<SortProps, "sortKey" | "sortDir" | "onSort"> {
	return { sortKey: props.sortKey, sortDir: props.sortDir, onSort: props.onSort };
}

export interface MembersTableProps extends SortProps {
	members: ProjectMemberRow[];
	context: MemberContext;
	showWorkload: boolean;
	renderActions: (member: ProjectMemberRow) => VNode | null;
	/** The member's open stage invitations, one line, beside the stages they hold. */
	renderPending?: (member: ProjectMemberRow) => VNode | null;
	onOpen: (member: ProjectMemberRow) => void;
}

/** The third column's heading — what the engagement says about each person's part in it. */
function partHeading(context: MemberContext): string | null {
	if (context.session) return "Attendance";
	if (context.stageChannel) return "Assignment";
	if (context.showStages) return "Stages";
	return null;
}

export function MembersTable(props: MembersTableProps): JSX.Element {
	const { context } = props;
	const part = partHeading(context);
	return (
		<ListShell
			label="Members"
			rowHeight={props.rowHeight}
			head={
				<>
					<SortHeader label="Member" col="name" {...sortOf(props)} />
					<SortHeader label="Role" col="role" {...sortOf(props)} />
					{part && <th scope="col">{part}</th>}
					{props.showWorkload && <SortHeader label="Workload" col="tickets" {...sortOf(props)} />}
					<SortHeader label="Joined" col="joined" class="mem-col--date" {...sortOf(props)} />
					<ActionsHead />
				</>
			}
		>
			{props.members.map((m) => (
				<tr key={m.id} class="mem-row" data-viewer={m.isViewer ? "true" : undefined}>
					<td>
						<PersonCell
							name={m.party.name}
							handle={m.party.handle}
							avatar={m.party.avatar}
							role={m.role}
							presence={m.presence}
							viewer={m.isViewer}
							onOpen={() =>
								props.onOpen(m)}
						/>
					</td>
					<td>
						<RoleText role={m.role} />
					</td>
					{part && (
						<td>
							{context.session
								? (m.attendance
									? <AttendanceTag attendance={m.attendance} />
									: <span class="mem-dash">—</span>)
								: (
									<div class="mem-partcell">
										<Facts facts={rosterFacts(m, context)} />
										{props.renderPending?.(m)}
									</div>
								)}
						</td>
					)}
					{props.showWorkload && (
						<td>
							<span class="mem-stat" data-has={m.openTickets > 0 ? "true" : undefined}>
								{m.ticketsLabel}
							</span>
						</td>
					)}
					<td class="mem-col--date">
						<span class="mem-stat">{m.joinedLabel}</span>
					</td>
					<td class="mem-col--actions">
						<div class="mem-rowactions">{props.renderActions(m)}</div>
					</td>
				</tr>
			))}
		</ListShell>
	);
}
// #endregion

// #region Requests
export interface RequestsTableProps extends SortProps {
	requests: MemberRequest[];
	busy: ReadonlySet<string>;
	renderActions: (request: MemberRequest) => VNode | null;
	onAccept: (request: MemberRequest) => void;
	onReject: (request: MemberRequest) => void;
	onOpen: (request: MemberRequest) => void;
}

export function RequestsTable(props: RequestsTableProps): JSX.Element {
	return (
		<ListShell
			label="Requests"
			rowHeight={props.rowHeight}
			head={
				<>
					<SortHeader label="Applicant" col="name" {...sortOf(props)} />
					<SortHeader label="Applied for" col="stage" {...sortOf(props)} />
					<th scope="col" class="mem-col--note">Note</th>
					<SortHeader label="Applied" col="date" class="mem-col--date" {...sortOf(props)} />
					<ActionsHead />
				</>
			}
		>
			{props.requests.map((r) => (
				<tr key={r.id} class="mem-row" aria-busy={props.busy.has(r.id) ? "true" : undefined}>
					<td>
						<PersonCell
							name={r.applicant.name}
							handle={r.applicant.handle}
							avatar={r.applicant.avatar}
							entity={r.applicantKind === "team"}
							onOpen={() =>
								props.onOpen(r)}
						/>
					</td>
					<td>
						<span class="mem-cell">{requestTarget(r)}</span>
					</td>
					<td class="mem-col--note">
						{r.message
							? <span class="mem-cell mem-cell--clamp">{r.message}</span>
							: <span class="mem-dash">—</span>}
					</td>
					<td class="mem-col--date">
						<span class="mem-stat">{r.appliedLabel}</span>
					</td>
					<td class="mem-col--actions">
						<div class="mem-rowactions">
							{props.renderActions(r)}
							<RequestDecision
								request={r}
								busy={props.busy.has(r.id)}
								onAccept={props.onAccept}
								onReject={props.onReject}
							/>
						</div>
					</td>
				</tr>
			))}
		</ListShell>
	);
}
// #endregion

// #region Invitations
export interface InvitesTableProps extends SortProps {
	invites: MemberInvite[];
	showStages: boolean;
	busy: ReadonlySet<string>;
	removable: (invite: MemberInvite) => boolean;
	renderActions: (invite: MemberInvite) => VNode | null;
	onRevoke: (invite: MemberInvite) => void;
	onDismiss: (invite: MemberInvite) => void;
	onRemove: (invite: MemberInvite) => void;
	onOpen: (invite: MemberInvite) => void;
}

export function InvitesTable(props: InvitesTableProps): JSX.Element {
	return (
		<ListShell
			label="Invitations"
			rowHeight={props.rowHeight}
			head={
				<>
					<SortHeader label="Invitee" col="name" {...sortOf(props)} />
					<SortHeader label="Status" col="status" {...sortOf(props)} />
					<th scope="col">Role</th>
					{props.showStages && <th scope="col">Stage</th>}
					<SortHeader label="Invited" col="date" class="mem-col--date" {...sortOf(props)} />
					<ActionsHead />
				</>
			}
		>
			{props.invites.map((invite) => {
				const person = inviteePerson(invite);
				const busy = props.busy.has(invite.id);
				return (
					<tr key={invite.id} class="mem-row" aria-busy={busy ? "true" : undefined}>
						<td>
							<PersonCell {...person} onOpen={() => props.onOpen(invite)} />
						</td>
						<td>
							<InviteStatusTag status={invite.status} />
						</td>
						<td>
							<span class="mem-cell">{roleMeta(invite.role).label}</span>
						</td>
						{props.showStages && (
							<td>
								<span class="mem-cell">{invite.stageName ?? "Whole project"}</span>
							</td>
						)}
						<td class="mem-col--date">
							<span class="mem-stat">{invite.invitedLabel}</span>
						</td>
						<td class="mem-col--actions">
							<div class="mem-rowactions">
								{props.renderActions(invite)}
								<InviteAction
									invite={invite}
									busy={busy}
									removable={props.removable(invite)}
									onRevoke={props.onRevoke}
									onDismiss={props.onDismiss}
									onRemove={props.onRemove}
								/>
							</div>
						</td>
					</tr>
				);
			})}
		</ListShell>
	);
}
// #endregion
