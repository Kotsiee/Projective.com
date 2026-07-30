import type { JSX, RefObject } from "preact";
import { Avatar, type AvatarSize } from "@projective/ui/display";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Checkbox } from "@projective/ui/fields";
import { styleVars } from "@ui/core/style.ts";
import {
	capabilitiesForKind,
	CAPABILITY_LABEL,
	type CellState,
	CONSEQUENTIAL,
	type PermissionFacet,
	roleLabel,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { membershipLabel, shortDate } from "../core/workspace-model.ts";

/**
 * MemberCard — the canonical presentation of one person in an entity, **and** the shared atom set the
 * whole members surface composes.
 *
 * The card, the table, the org chart, the member drawer, the invitation queue and the roles matrix all
 * need the same handful of pieces: a circular person avatar, a workload meter, the `+`/`−` override
 * markers, a capability chip, the capability GROUPING the matrix and the role editor must agree on, and
 * the rule that decides whether a granted capability is plainly `allowed` or `conditional`. Those live
 * here, beside the canonical member presentation, so there is one set rather than six — six copies of a
 * capability grouping is how a matrix and a role editor start teaching two different mental models of
 * the same permission system.
 *
 * **People are circular.** Every avatar on this surface is `Avatar` from `@projective/ui`; the rounded
 * square belongs to entities and nothing here ever gives a person one. The distinction carries real
 * information on a page where an entity and its members appear together.
 *
 * The three-layer model (`role ∪ granted − revoked`) is **presented, never recomputed**: the override
 * markers render the facets the SSOT's `permissionFacets` produced. Nothing in this file derives an
 * effective permission of its own.
 */

// #region Local icons
/**
 * Local glyphs are **function components**, not the module-level VNode constants of
 * `workspace-glyphs.tsx`. Everything here renders inside a list — a roster of twenty members mounts the
 * kebab twenty times in one tree — and Preact reuses a VNode by identity, so a shared constant would
 * silently drop from every position but the first. A function yields a fresh node per call site, which
 * is the same reason `packages/ui`'s own `Checkbox` builds its tick that way.
 */
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			width="1em"
			height="1em"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
			{...props}
		/>
	);
}

/** A vertical ellipsis — the row's own action menu. */
export function KebabIcon(): JSX.Element {
	return (
		<Svg>
			<circle cx="12" cy="5.2" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="12" cy="18.8" r="1.4" fill="currentColor" stroke="none" />
		</Svg>
	);
}

/** A closed padlock — the read-only signal on a preset role, legible in greyscale. */
export function LockIcon(): JSX.Element {
	return (
		<Svg>
			<rect x="5" y="10.5" width="14" height="9.5" rx="2" />
			<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
		</Svg>
	);
}

/** A bare tick — the `allowed` cell mark and a satisfied permission row. */
export function TickIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M5 12.5l4.5 4.5L19 7" />
		</Svg>
	);
}

/**
 * The `conditional` mark — a tick over a rule.
 *
 * Two marks rather than one, so the silhouette differs from a plain tick at 18px and in greyscale: the
 * state means "allowed, but bounded by a written rule", and drawing it as a tick with something under
 * it says exactly that without spending a colour.
 */
export function ConditionalIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M5.5 10.5l4 4L18.5 5" />
			<path d="M6 19h12" />
		</Svg>
	);
}

/** A hollow warning triangle — flags a capability whose consequences are severe. */
export function ConsequenceIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M12 4.5l8.5 15H3.5z" />
			<path d="M12 10v4.2M12 17.2v.1" />
		</Svg>
	);
}

/** A shield with a tick — the permissions view of one member. */
export function PermissionsIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M12 3l7.5 3v5.5c0 4.4-3 8-7.5 9.5-4.5-1.5-7.5-5.1-7.5-9.5V6z" />
			<path d="M8.8 12l2.4 2.4 4-4.4" />
		</Svg>
	);
}

/** A magnifier — the roster's own search adornment. */
export function SearchIcon(): JSX.Element {
	return (
		<Svg>
			<circle cx="11" cy="11" r="6.2" />
			<path d="M15.6 15.6L20 20" />
		</Svg>
	);
}

/** Cards — the roster's default density. */
export function CardsViewIcon(): JSX.Element {
	return (
		<Svg>
			<rect x="3.5" y="4" width="7" height="7" rx="1.5" />
			<rect x="13.5" y="4" width="7" height="7" rx="1.5" />
			<rect x="3.5" y="13" width="7" height="7" rx="1.5" />
			<rect x="13.5" y="13" width="7" height="7" rx="1.5" />
		</Svg>
	);
}

/** Table — the dense, comparable reading. */
export function TableViewIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
			<path d="M9 6.5v11" />
		</Svg>
	);
}

/** Org chart — the reporting tree the same roster can be read as. */
export function ChartViewIcon(): JSX.Element {
	return (
		<Svg>
			<rect x="9" y="3.5" width="6" height="4.5" rx="1.2" />
			<rect x="3" y="16" width="5.5" height="4.5" rx="1.2" />
			<rect x="15.5" y="16" width="5.5" height="4.5" rx="1.2" />
			<path d="M12 8v4M5.75 16v-4h12.5v4" />
		</Svg>
	);
}

/** An outbound arrow — we asked them (an invitation we sent). */
export function InviteOutIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M4 12h13M13 7.5l4.5 4.5L13 16.5" />
			<path d="M20 5v14" />
		</Svg>
	);
}

/** An inbound arrow — they asked us (a join request). */
export function InviteInIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M20 12H7M11 7.5L6.5 12l4.5 4.5" />
			<path d="M4 5v14" />
		</Svg>
	);
}

/** A chain link — a shareable invitation URL. */
export function LinkIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M10.5 13.5a3.5 3.5 0 0 1 0-5l2.2-2.2a3.5 3.5 0 0 1 5 5l-1.2 1.2" />
			<path d="M13.5 10.5a3.5 3.5 0 0 1 0 5l-2.2 2.2a3.5 3.5 0 0 1-5-5l1.2-1.2" />
		</Svg>
	);
}

/** Overlapping sheets — copy to the clipboard. */
export function CopyIcon(): JSX.Element {
	return (
		<Svg>
			<rect x="9" y="9" width="11" height="11" rx="2" />
			<path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
		</Svg>
	);
}

/** A cross — decline, revoke, dismiss. */
export function CrossIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M6 6l12 12M18 6L6 18" />
		</Svg>
	);
}

/** A tick in a ring — approve a join request. */
export function ApproveIcon(): JSX.Element {
	return (
		<Svg>
			<circle cx="12" cy="12" r="8.4" />
			<path d="M8.4 12.3l2.6 2.6 4.6-5.2" />
		</Svg>
	);
}

/** A circular arrow — resend a lapsed invitation. */
export function ResendIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
			<path d="M19.5 4.5V7h-2.5" />
		</Svg>
	);
}

/** A speech bubble — message this person. */
export function MessageIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" />
		</Svg>
	);
}

/** A crown — ownership, and the transfer of it. */
export function CrownIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M4 17.5h16M4.5 6.5l3.5 4L12 4.5l4 6 3.5-4-1.5 9.5h-13z" />
		</Svg>
	);
}

/** A duplicate — copy a preset's bundle into an editable custom role. */
export function DuplicateIcon(): JSX.Element {
	return (
		<Svg>
			<rect x="4" y="4" width="11" height="11" rx="2" />
			<path d="M9 19a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2" />
		</Svg>
	);
}

/** A pencil — edit a custom role. */
export function EditIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M4 20h4l10-10-4-4L4 16z" />
			<path d="M13.5 6.5l4 4" />
		</Svg>
	);
}

/** A bin — retire a custom role. */
export function TrashIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M5 7.5h14M9.5 7.5V5.5h5v2M6.5 7.5l1 12h9l1-12" />
		</Svg>
	);
}

/** A chevron — node disclosure in the org chart. Rotated by CSS on the block axis. */
export function ChevronDownIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M6 9.5l6 6 6-6" />
		</Svg>
	);
}
// #endregion

// #region Capability grouping
/** A named run of capabilities — the matrix's row groups and the role editor's columns. */
export interface CapabilityGroup {
	/** Heading, sentence case. */
	title: string;
	capabilities: readonly WorkspaceCapability[];
}

/**
 * Every capability, grouped by what it governs — the ONE grouping the matrix rows, the role editor and
 * the member drawer share.
 *
 * The groups mirror the SSOT enum's own runs, so a capability added there falls into an obvious slot
 * here. {@link capabilityGroupsFor} then scopes them to the kind, which is why the union covers all
 * eighteen even though neither kind renders all eighteen.
 */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
	{ title: "Membership", capabilities: ["invite_members", "remove_members", "manage_roles"] },
	{ title: "Identity", capabilities: ["edit_profile", "manage_settings"] },
	{ title: "Delivery", capabilities: ["bind_seat", "manage_projects", "publish_listings"] },
	{ title: "Commerce", capabilities: ["purchase", "hire"] },
	{
		title: "Money",
		capabilities: [
			"contribute_funds",
			"spend_funds",
			"withdraw_funds",
			"manage_finances",
			"approve_spend",
		],
	},
	{ title: "Oversight", capabilities: ["view_analytics", "view_audit"] },
	{ title: "Terminal", capabilities: ["archive_entity"] },
];

/**
 * The capability groups a kind renders, with kind-excluded capabilities dropped and empty groups
 * removed — a heading over nothing tells the reader something is being withheld.
 */
export function capabilityGroupsFor(kind: WorkspaceKind): CapabilityGroup[] {
	const allowed = new Set(capabilitiesForKind(kind));
	return CAPABILITY_GROUPS
		.map((group) => ({
			title: group.title,
			capabilities: group.capabilities.filter((c) => allowed.has(c)),
		}))
		.filter((group) => group.capabilities.length > 0);
}

/** Whether a capability's consequences are severe enough to be surfaced rather than merely listed. */
export function isConsequential(capability: WorkspaceCapability): boolean {
	return CONSEQUENTIAL.includes(capability);
}
// #endregion

// #region Conditional rules
/** The slice of the detail projection the conditional rules read. */
export type PolicyContext = Pick<WorkspaceDetail, "kind" | "payout" | "spend" | "canPropose">;

/**
 * The written rule that bounds a granted capability, or `null` when the grant is unqualified.
 *
 * This is what makes the matrix's third state honest. `conditional` is not "half allowed" — it means
 * the capability applies only under a rule the entity has actually configured, and the rule is the
 * cell's tooltip. Every rule below is read from **server state** on the detail projection, never
 * invented: a spend ladder the business set up, a withdrawal approver list the team nominated, the
 * two-member floor a one-person team has not yet cleared. A capability with no configured rule renders
 * as a plain tick, because hedging an unqualified grant under-promises exactly as badly as a bare tick
 * over-promises a bounded one.
 */
export function conditionalRuleFor(
	capability: WorkspaceCapability,
	workspace: PolicyContext,
): string | null {
	if (capability === "spend_funds") {
		const threshold = workspace.spend?.approvalThreshold?.display;
		return threshold ? `Spending at or above ${threshold} needs an approver's sign-off.` : null;
	}
	if (capability === "withdraw_funds") {
		return (workspace.payout?.withdrawApprovers.length ?? 0) > 0
			? "A withdrawal needs a nominated approver's sign-off before it leaves the vault."
			: null;
	}
	if (capability === "bind_seat" && workspace.canPropose === false) {
		return "The team needs at least two active members before it can bid for a seat.";
	}
	return null;
}

/**
 * The tri-state a cell or a permission row renders: `denied` when the capability is not granted at all,
 * `conditional` when it is granted but bounded by a configured rule, else `allowed`.
 */
export function cellStateFor(
	granted: boolean,
	capability: WorkspaceCapability,
	workspace: PolicyContext,
): CellState {
	if (!granted) return "denied";
	return conditionalRuleFor(capability, workspace) === null ? "allowed" : "conditional";
}

/** The mark for a cell state — three states, three silhouettes, so hue is never the first channel. */
export function StateMark(props: { state: CellState }): JSX.Element {
	if (props.state === "allowed") {
		return (
			<span class="wsp-matrix__mark">
				<TickIcon />
			</span>
		);
	}
	if (props.state === "conditional") {
		return (
			<span class="wsp-matrix__mark">
				<ConditionalIcon />
			</span>
		);
	}
	return <span class="wsp-matrix__mark wsp-matrix__mark--denied" />;
}
// #endregion

// #region Shared atoms
/** The canonical profile link for a member — `/@handle` (root CLAUDE.md §8 Decision #3). */
export function memberProfileHref(handle: string): string {
	const clean = handle.startsWith("@") ? handle.slice(1) : handle;
	return `/@${clean}`;
}

/** The display name of the role a member holds — a custom role's own name, else the preset label. */
export function roleNameOf(
	member: Pick<WorkspaceMember, "roleId" | "rolePreset">,
	roles: readonly WorkspaceRoleDef[],
): string {
	return roles.find((r) => r.id === member.roleId)?.name ?? roleLabel(member.rolePreset);
}

/** A circular person avatar with an initials fallback. Never a rounded square — squares are entities. */
export function PersonAvatar(props: {
	member: Pick<WorkspaceMember, "name" | "avatar">;
	size?: AvatarSize;
	class?: string;
}): JSX.Element {
	const { member, size = "md", class: className } = props;
	return (
		<Avatar
			shape="circle"
			size={size}
			image={member.avatar || undefined}
			label={member.name}
			alt=""
			class={className}
		/>
	);
}

/** One-line availability sentence — the words a tooltip carries so the dot can stay wordless (§B.6). */
export function availabilityPhrase(availability: WorkspaceMember["availability"]): string {
	if (availability === "available") return "available for work";
	if (availability === "limited") return "limited availability";
	return "unavailable";
}

/**
 * The workload meter. The fill's `inline-size` **encodes** the commitment, so it is delivered as a data
 * custom property and never transitioned or keyframed: a frozen animation clock must not be able to
 * render a fully-committed member as idle (root CLAUDE.md §11).
 */
export function WorkloadMeter(props: { workload: number; label?: string }): JSX.Element {
	const { workload, label = "Workload" } = props;
	const clamped = Math.max(0, Math.min(100, Math.round(workload)));
	return (
		<div class="wsp-mcard__load" data-tone={clamped >= 90 ? "full" : undefined}>
			<span class="ui-visually-hidden">{`${label} ${clamped}%`}</span>
			<span class="wsp-mcard__load-track" aria-hidden="true">
				<span class="wsp-mcard__load-fill" style={styleVars({ "--wsp-fill": clamped / 100 })} />
			</span>
			<span class="wsp-mcard__load-text wsp-num" aria-hidden="true">{`${clamped}%`}</span>
		</div>
	);
}

/** One `+ granted` / `− revoked` marker, read against the role baseline. */
export function OverrideChip(props: { facet: PermissionFacet }): JSX.Element {
	const { facet } = props;
	const grant = facet.override === "grant";
	const label = CAPABILITY_LABEL[facet.capability];
	return (
		<Tooltip
			content={grant
				? `Granted individually, on top of the role: ${label}.`
				: `Revoked individually, against the role: ${label}.`}
		>
			<span class="wsp-override" data-override={facet.override ?? undefined}>
				<span class="wsp-override__sign" aria-hidden="true">{grant ? "+" : "−"}</span>
				{label}
			</span>
		</Tooltip>
	);
}

/**
 * The override summary — the whole reason the three-layer model is legible on a roster.
 *
 * A member whose effective set differs from their role is **never** shown as just the role name: the
 * reader would have to diff two capability lists in their head to notice somebody can move money their
 * role does not permit. Overflow collapses to a count rather than truncating silently, so the row still
 * admits there is more.
 */
export function OverrideChips(
	props: { facets: readonly PermissionFacet[]; max?: number },
): JSX.Element | null {
	const { facets, max = 3 } = props;
	const changed = facets.filter((f) => f.override !== null);
	if (changed.length === 0) return null;
	const shown = changed.slice(0, max);
	const rest = changed.length - shown.length;
	return (
		<div class="wsp-mcard__overrides">
			{shown.map((facet) => <OverrideChip key={facet.capability} facet={facet} />)}
			{rest > 0 && (
				<Tooltip
					content={changed.slice(max).map((f) => CAPABILITY_LABEL[f.capability]).join(", ")}
				>
					<span class="wsp-override wsp-num">{`+${rest} more`}</span>
				</Tooltip>
			)}
		</div>
	);
}

/** A capability pill — the invite preview's role summary and the drawer's consequential group. */
export function CapChip(props: { capability: WorkspaceCapability }): JSX.Element {
	const { capability } = props;
	const severe = isConsequential(capability);
	return (
		<span class="wsp-capchip" data-level={severe ? "consequential" : undefined}>
			{severe && <ConsequenceIcon />}
			{CAPABILITY_LABEL[capability]}
		</span>
	);
}

/** A membership-state dot with the state in its tooltip — iconographic, never inline prose (§B.6). */
export function MembershipDot(props: { state: WorkspaceMember["state"] }): JSX.Element {
	const { state } = props;
	return (
		<Tooltip content={membershipLabel(state)}>
			<span
				class="wsp-statedot"
				data-state={state === "active" ? "active" : state === "left" ? "archived" : "draft"}
			>
				<span class="ui-visually-hidden">{membershipLabel(state)}</span>
			</span>
		</Tooltip>
	);
}
// #endregion

// #region Row actions
/** Everything a member row can ask the surface to do. */
export type MemberAction =
	/** Open the member drawer — role, overrides, envelope, removal. */
	| "open"
	/** Message them. */
	| "message"
	/** Open their public profile. */
	| "profile"
	/** Soft-remove them from the entity. */
	| "remove"
	/** Route the last owner to an ownership transfer instead of a dead-end refusal. */
	| "transfer";

/** Whether the viewer may act on a row, and what stands in the way when they may not. */
export interface MemberGuards {
	/** `mayManageMember(actor, target, kind)` from the SSOT, resolved by the caller. */
	manageable: boolean;
	/** Whether removing or demoting them would leave the entity ownerless. */
	lastOwner: boolean;
}

/** The reason a row's management actions are unavailable, or `null` when they are available. */
export function manageBlockedReason(
	member: Pick<WorkspaceMember, "isSelf">,
	guards: MemberGuards,
): string | null {
	if (guards.manageable) return null;
	return member.isSelf
		? "You cannot change your own role or membership here."
		: "You need a higher role than theirs to change their membership.";
}

/**
 * The row's action menu.
 *
 * Every gated item stays **visible and disabled with its reason in a tooltip** rather than vanishing: a
 * control that disappears teaches nothing, and on a permission surface the reader's next question is
 * always "why can't I?". The last owner's Remove is not merely disabled — it re-routes to the ownership
 * transfer, because refusing there would leave an entity nobody can ever hand over.
 */
export function MemberActionsMenu(props: {
	member: WorkspaceMember;
	guards: MemberGuards;
	onAction: (action: MemberAction, member: WorkspaceMember) => void;
	class?: string;
}): JSX.Element {
	const { member, guards, onAction, class: className } = props;
	const reason = manageBlockedReason(member, guards);

	return (
		<Popover
			placement="bottom-end"
			avoid={[".ui-app-shell__sidebar", ".ui-middle-nav__lane"]}
			trigger={(api) => (
				<Tooltip content={`Actions for ${member.name}`}>
					<button
						type="button"
						ref={api.ref as RefObject<HTMLButtonElement>}
						class={className ?? "wsp-mcard__kebab"}
						aria-label={`Actions for ${member.name}`}
						aria-haspopup="menu"
						aria-expanded={api.expanded}
						aria-controls={api.panelId}
						onClick={(event) => {
							event.stopPropagation();
							api.toggle();
						}}
					>
						<KebabIcon />
					</button>
				</Tooltip>
			)}
		>
			<div class="wsp-menu" role="menu" aria-label={`Actions for ${member.name}`}>
				<button
					type="button"
					role="menuitem"
					class="wsp-menu__item"
					onClick={() => onAction("open", member)}
				>
					<PermissionsIcon />
					Role and permissions
				</button>
				<button
					type="button"
					role="menuitem"
					class="wsp-menu__item"
					onClick={() => onAction("message", member)}
				>
					<MessageIcon />
					Message
				</button>
				<button
					type="button"
					role="menuitem"
					class="wsp-menu__item"
					onClick={() => onAction("profile", member)}
				>
					<PersonAvatarlessProfileIcon />
					View profile
				</button>
				{guards.lastOwner
					? (
						<button
							type="button"
							role="menuitem"
							class="wsp-menu__item"
							onClick={() => onAction("transfer", member)}
						>
							<CrownIcon />
							Transfer ownership…
						</button>
					)
					: (
						<Tooltip content={reason ?? `Remove ${member.name} from the entity.`}>
							<button
								type="button"
								role="menuitem"
								class="wsp-menu__item"
								data-variant="danger"
								disabled={!guards.manageable}
								onClick={() => onAction("remove", member)}
							>
								<TrashIcon />
								Remove
							</button>
						</Tooltip>
					)}
			</div>
		</Popover>
	);
}

/** A person outline — "view profile", distinct from the avatar it sits beside. */
function PersonAvatarlessProfileIcon(): JSX.Element {
	return (
		<Svg>
			<circle cx="12" cy="8.5" r="3.6" />
			<path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
		</Svg>
	);
}
// #endregion

// #region MemberCard
export interface MemberCardProps {
	member: WorkspaceMember;
	kind: WorkspaceKind;
	roles: readonly WorkspaceRoleDef[];
	/** The per-capability breakdown from the SSOT's `permissionFacets` — presented, never recomputed. */
	facets: readonly PermissionFacet[];
	guards: MemberGuards;
	/** Bulk-selection state. Omit `onSelect` to render the card without a selection control. */
	selected?: boolean;
	onSelect?: (memberId: string, next: boolean) => void;
	onAction: (action: MemberAction, member: WorkspaceMember) => void;
	/** Server-resolved reference year, so an SSR date and its hydration agree across a New Year. */
	referenceYear?: number;
}

/**
 * One member, at card density.
 *
 * The card carries five facts in five channels: who (circular avatar + name + handle), what they may do
 * (role name, plus the override markers whenever their effective set differs from it), where they stand
 * (membership dot), how loaded they are (availability dot + workload meter), and their money position
 * (payout share on a team, spend permission on a business). Statuses are iconographic with the words in
 * their tooltips (§B.6), and nothing here is a four-sided box (§B.4 — the tonal fill is the separator).
 *
 * **No money is composed here.** A team shows its integer basis-point share as a percentage — share
 * arithmetic, which is exact — and a business states whether a ceiling exists rather than inventing a
 * figure out of minor units, because the client never formats currency (root CLAUDE.md §12). The real
 * envelopes are the Spend module's server-formatted `MoneyView`s.
 */
export function MemberCard(props: MemberCardProps): JSX.Element {
	const { member, kind, roles, facets, guards, selected, onSelect, onAction, referenceYear } =
		props;
	const role = roleNameOf(member, roles);

	return (
		<article
			class="wsp-mcard"
			data-self={member.isSelf ? "true" : undefined}
			data-state={member.state !== "active" ? member.state : undefined}
			aria-label={`${member.name}, ${role}`}
		>
			<div class="wsp-mcard__top">
				<Tooltip content={`${member.name} — ${availabilityPhrase(member.availability)}`}>
					<span class="wsp-mcard__avatarwrap">
						<PersonAvatar member={member} size="lg" class="wsp-mcard__avatar" />
						<span class="wsp-mcard__avail" data-avail={member.availability} aria-hidden="true" />
					</span>
				</Tooltip>

				<div class="wsp-mcard__ident">
					<h3 class="wsp-mcard__name">
						<a class="wsp-mcard__name-link" href={memberProfileHref(member.handle)}>
							{member.name}
						</a>
						<MembershipDot state={member.state} />
					</h3>
					{member.title && <span class="wsp-mcard__title">{member.title}</span>}
					<span class="wsp-mcard__handle">{`@${member.handle} · ${role}`}</span>
				</div>

				<div class="wsp-mcard__flags">
					{onSelect && (
						<Checkbox
							value={selected ?? false}
							onValueChange={(next) => onSelect(member.id, next)}
							aria-label={`Select ${member.name}`}
						/>
					)}
					<Tooltip content={`Role and permissions for ${member.name}`}>
						<button
							type="button"
							class="wsp-mcard__kebab"
							aria-label={`Role and permissions for ${member.name}`}
							onClick={() => onAction("open", member)}
						>
							<PermissionsIcon />
						</button>
					</Tooltip>
					<MemberActionsMenu member={member} guards={guards} onAction={onAction} />
				</div>
			</div>

			<WorkloadMeter workload={member.workload} />

			<div class="wsp-mcard__money">
				{kind === "team"
					? (
						<>
							<span class="wsp-label">Payout share</span>
							<span class="wsp-num">
								{`${(member.shareBp / 100).toFixed(member.shareBp % 100 === 0 ? 0 : 2)}%`}
								{member.shareHeld ? " · held" : ""}
							</span>
						</>
					)
					: (
						<>
							<span class="wsp-label">Spending</span>
							<span>
								{member.spendLimitMinor === null ? "No personal ceiling" : "Ceiling set"}
							</span>
						</>
					)}
			</div>

			<div class="wsp-mcard__money">
				<span class="wsp-label">
					{member.state === "invited"
						? "Invited"
						: member.state === "requested"
						? "Asked"
						: "Joined"}
				</span>
				<span class="wsp-num">{shortDate(member.joinedAt, referenceYear)}</span>
			</div>

			<OverrideChips facets={facets} />
		</article>
	);
}
// #endregion
