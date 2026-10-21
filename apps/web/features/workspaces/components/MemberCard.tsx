import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { type AvatarSize, Badge, MetaLine, type MetaLineEntry } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { ActionMenu, type ContextSurfaceSource, type MenuItem } from "@projective/ui/navigation";
import {
	kindCopy,
	type PermissionFacet,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import type { MemberPresence } from "@projective/types/projects";
import { shortDate } from "../core/workspace-model.ts";
import {
	overrideItems,
	overrideSummary,
	overrideTitle,
	roleText,
	sensitiveLabel,
	stakePercent,
	workloadText,
} from "../core/members-model.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { MemberCard as ProjectMemberCard } from "@web/features/projects/components/MemberCard.tsx";
import { MessageButton } from "@web/features/projects/components/MemberSectionCards.tsx";

/**
 * MemberCard — one person in an entity at card density (the People reading's grid half), drawn in the
 * project roster's card (Decision #319), **and** the small set of person atoms and glyphs the members
 * surface composes.
 *
 * **Facts are a MetaLine, never chips** (§B.11): handle, "You", role, title, stake, joined date and the
 * override counts are inline `--text-secondary` text joined by middots. The only containers left are
 * controls (the two icon buttons) and the one count a reader must not miss — how many sensitive
 * capabilities this person was granted beyond their role — as a `Badge`.
 *
 * **People are circular.** Every avatar here is `UserAvatar` (the ui `Avatar` with the person
 * stand-in); the rounded square belongs to entities, and the distinction carries information on a page
 * where an entity and its members appear together.
 *
 * Every rule the card shows — role text, override counts, the stake, the W_i figure, which menu rows
 * exist — is computed in `core/members-model.ts`, where it is unit-tested; the card only draws it.
 */

// #region Local icons
/**
 * Local glyphs are **function components**, not module-level VNode constants: a roster of twenty
 * members mounts the kebab twenty times in one tree, and Preact reuses a VNode by identity, so a shared
 * constant would silently drop from every position but the first.
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

/** A hollow warning triangle — flags a capability whose consequences are severe. */
export function ConsequenceIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M12 4.5l8.5 15H3.5z" />
			<path d="M12 10v4.2M12 17.2v.1" />
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

/** Cards — the grid half of the People zoom. */
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

/** A cross — decline, revoke, dismiss. */
export function CrossIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M6 6l12 12M18 6L6 18" />
		</Svg>
	);
}

/** A tick in a ring — approve a spend request. */
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

/** A chevron — node disclosure in the org chart. Rotated by CSS on the block axis. */
export function ChevronDownIcon(): JSX.Element {
	return (
		<Svg>
			<path d="M6 9.5l6 6 6-6" />
		</Svg>
	);
}
// #endregion

// #region Shared atoms
/** A circular person avatar with the person stand-in, then initials. Never a rounded square. */
export function PersonAvatar(props: {
	member: Pick<WorkspaceMember, "name" | "avatar">;
	size?: AvatarSize;
	class?: string;
}): JSX.Element {
	const { member, size = "md", class: className } = props;
	return (
		<UserAvatar
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
 * The count of sensitive grants — a number badge (a count is a permitted container, §B.11), its
 * sentence for assistive tech beside it, the capabilities by name on hover. Nothing when there are none.
 */
export function SensitiveCount(props: { facets: readonly PermissionFacet[] }): JSX.Element | null {
	const summary = overrideSummary(props.facets);
	const label = sensitiveLabel(summary);
	if (!label) return null;
	return (
		<Tooltip content={label}>
			<span class="wsp-sensitive">
				<Badge value={summary.sensitive.length} severity="warning" size="sm" />
				<span class="ui-visually-hidden">{label}</span>
			</span>
		</Tooltip>
	);
}

/**
 * A member's overrides as one MetaLine — "+2 granted · −1 revoked", or "Role default" — with every
 * override by name in its hover title, and the sensitive count beside it.
 */
export function OverrideLine(props: {
	facets: readonly PermissionFacet[];
	/** Say "Role default" when nothing differs (the table) rather than drawing nothing (the card). */
	showDefault?: boolean;
	class?: string;
}): JSX.Element | null {
	const summary = overrideSummary(props.facets);
	const changed = summary.granted.length + summary.revoked.length > 0;
	if (!changed && !props.showDefault) return null;
	const title = overrideTitle(summary);
	const items = overrideItems(summary).map((item) =>
		typeof item === "string" ? item : { ...item, title }
	);
	return (
		<span class={props.class ?? "wsp-overrides"}>
			<MetaLine as="span" size="xs" items={items} />
			<SensitiveCount facets={props.facets} />
		</span>
	);
}
// #endregion

// #region Row actions
const MENU_AVOID = [".ui-app-shell__sidebar", ".ui-middle-nav__lane"] as const;

/** Props for {@link MemberActionsMenu}. */
export interface MemberActionsMenuProps {
	member: Pick<WorkspaceMember, "name">;
	/** The rows — `memberMenu` from the model, holding only what the viewer may do. */
	menu: MenuItem[];
	/** The card this menu belongs to; right-click on it opens the same rows at the pointer (#222). */
	surface?: ContextSurfaceSource;
}

/** The card's kebab: a tier-5 icon-only Button opening the row's menu. */
export function MemberActionsMenu(props: MemberActionsMenuProps): JSX.Element {
	const { member, menu, surface } = props;
	const label = `Actions for ${member.name}`;
	return (
		<ActionMenu
			model={menu}
			surface={surface}
			placement="bottom-end"
			avoid={MENU_AVOID}
			aria-label={label}
			trigger={(api) => (
				<Tooltip content={label}>
					<Button
						triggerRef={api.ref}
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						icon={<KebabIcon />}
						aria-label={label}
						aria-haspopup="menu"
						aria-expanded={api.expanded}
						aria-controls={api.panelId}
						onClick={(event: MouseEvent) => {
							event.stopPropagation();
							api.toggle();
						}}
					/>
				</Tooltip>
			)}
		/>
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
	/** The row's menu (`memberMenu`) — only what the viewer may do. */
	menu: MenuItem[];
	/** Whether the viewer reads payout stakes (`showsStake`). */
	showStake: boolean;
	/**
	 * A business member's envelope as one fact (`spendingFact`) — present only for a viewer the read
	 * gave every envelope; `null` draws nothing.
	 */
	envelope?: MetaLineEntry | null;
	/** Open the member drawer. */
	onOpen: () => void;
	/** Open the viewer's conversation with them — the corner Message button; absent draws none. */
	onMessage?: () => void;
	/** Server-resolved reference year, so an SSR date and its hydration agree across a New Year. */
	referenceYear?: number;
}

/** A team member's availability in the presence dot's three tones. */
const AVAILABILITY_TONE: Record<WorkspaceMember["availability"], MemberPresence> = {
	available: "online",
	limited: "away",
	unavailable: "offline",
};

/** One MetaLine entry's words. */
function entryText(entry: MetaLineEntry | null | undefined): string | null {
	if (!entry) return null;
	return typeof entry === "string" ? entry : entry.text;
}

/**
 * One member at card density — the project roster's card (Decision #319): the shared `MemberCard`
 * shell from `features/projects` (a banner seam in the card's accent, the large avatar centred on it,
 * the name and `@handle`, then left-aligned facts and a foot), filled with this entity's facts. The
 * headline is the role; the meta line their title and, for a viewer who reads payouts, a team
 * member's stake, or a business member's envelope (BU7); the overrides line says how their effective
 * permissions differ from the role. The foot states a team member's workload and when they joined.
 *
 * The owner wears the shell's authority crown, named for the kind. Whether somebody is free to take
 * work is a seller's fact, so the availability dot — the shell's presence dot, in its three tones — is
 * a team's alone; a business is buyer-side. A plain click opens the member drawer, a modified click
 * their profile in a new tab (the shell's click matrix); the corner holds Message and the kebab, which
 * a right-click on the card also opens (#222).
 */
export function MemberCard(props: MemberCardProps): JSX.Element {
	const { member, kind, roles, facets, menu, showStake, referenceYear } = props;
	const actionsRef = useRef<HTMLSpanElement>(null);
	const owner = member.rolePreset === "owner";
	const team = kind === "team";

	return (
		<ProjectMemberCard
			person={{ name: member.name, handle: member.handle, avatar: member.avatar || null }}
			seed={member.id}
			role={owner ? "owner" : undefined}
			authorityLabel={owner ? `${kindCopy(kind).Noun} owner` : undefined}
			viewer={member.isSelf}
			presence={team ? AVAILABILITY_TONE[member.availability] : undefined}
			presenceLabel={team ? capitalise(availabilityPhrase(member.availability)) : undefined}
			actions={
				<span class="wsp-mcard__actions" ref={actionsRef}>
					{!member.isSelf && props.onMessage && (
						<MessageButton
							target={{ name: member.name, handle: member.handle, avatar: member.avatar || null }}
							onMessage={() => props.onMessage?.()}
						/>
					)}
					<MemberActionsMenu
						member={member}
						menu={menu}
						surface={() => actionsRef.current?.closest<HTMLElement>(".mem-card") ?? null}
					/>
				</span>
			}
			headline={roleText(member, roles)}
			meta={[
				member.title,
				showStake && team
					? `Stake ${stakePercent(member.shareBp)}${member.shareHeld ? " (held)" : ""}`
					: null,
				team ? null : entryText(props.envelope),
			]}
			pending={<OverrideLine facets={facets} />}
			foot={[
				team
					? (
						<span class="mem-stat" data-has={member.wi > 0 ? "true" : undefined} key="load">
							Workload {workloadText(member)}
						</span>
					)
					: null,
				<span class="mem-stat" key="joined">
					Joined {shortDate(member.joinedAt, referenceYear)}
				</span>,
			]}
			onOpen={props.onOpen}
		/>
	);
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
// #endregion
