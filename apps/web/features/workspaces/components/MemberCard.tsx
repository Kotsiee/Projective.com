import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { type AvatarSize, Badge, MetaLine } from "@projective/ui/display";
import { ProgressBar, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { ActionMenu, type ContextSurfaceSource, type MenuItem } from "@projective/ui/navigation";
import type {
	PermissionFacet,
	WorkspaceKind,
	WorkspaceMember,
	WorkspaceRoleDef,
} from "@projective/types/workspace";
import { shortDate } from "../core/workspace-model.ts";
import {
	formatWi,
	memberProfileHref,
	overrideItems,
	overrideSummary,
	overrideTitle,
	roleMetaText,
	roleText,
	sensitiveLabel,
	stakePercent,
	workloadText,
} from "../core/members-model.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * MemberCard — one person in an entity at card density (the People reading's grid half), **and** the
 * small set of person atoms and glyphs the members surface composes.
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
 * The `conditional` mark — a tick over a rule: "allowed, but bounded by a written rule", told apart
 * from a plain tick by silhouette rather than colour.
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
	/** Open the member drawer. */
	onOpen: () => void;
	/** Server-resolved reference year, so an SSR date and its hydration agree across a New Year. */
	referenceYear?: number;
}

/**
 * One member, at card density: who (avatar, name, handle, "You"), what they may do (role, and the
 * override counts whenever their effective set differs from it), how loaded they are (a `ProgressBar`
 * over their W_i against their cap), and — for a viewer who reads payouts — their stake. The viewer's
 * own card keeps W1's leading rule as well as saying "You".
 */
export function MemberCard(props: MemberCardProps): JSX.Element {
	const { member, kind, roles, facets, menu, showStake, onOpen, referenceYear } = props;
	const role = roleText(member, roles);
	/** The role as ONE MetaLine item — its own middot would read as the line's separator. */
	const roleMeta = roleMetaText(member, roles);
	const cardRef = useRef<HTMLElement>(null);
	const load = workloadText(member);

	return (
		<article
			ref={cardRef}
			class="wsp-mcard"
			data-self={member.isSelf ? "true" : undefined}
			aria-label={`${member.name}, ${role}`}
		>
			<div class="wsp-mcard__top">
				<Tooltip content={`${member.name} — ${availabilityPhrase(member.availability)}`}>
					<span class="wsp-mcard__avatarwrap">
						<PersonAvatar member={member} size="lg" />
						<span class="wsp-mcard__avail" data-avail={member.availability} aria-hidden="true" />
					</span>
				</Tooltip>

				<div class="wsp-mcard__ident">
					<h3 class="wsp-mcard__name">
						<a class="wsp-mcard__name-link" href={memberProfileHref(member.handle)}>
							{member.name}
						</a>
					</h3>
					<MetaLine size="xs" items={[`@${member.handle}`, member.isSelf && "You"]} />
					<MetaLine size="xs" items={[roleMeta, member.title]} />
				</div>

				<div class="wsp-mcard__flags">
					<Tooltip content={`Role and permissions for ${member.name}`}>
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							iconOnly
							icon={<PermissionsIcon />}
							aria-label={`Role and permissions for ${member.name}`}
							onClick={onOpen}
						/>
					</Tooltip>
					<MemberActionsMenu member={member} menu={menu} surface={cardRef} />
				</div>
			</div>

			<div class="wsp-mcard__load">
				<ProgressBar
					class="wsp-mcard__meter"
					value={member.workload}
					severity={member.workload >= 90 ? "warning" : "primary"}
					aria-label={`Workload ${formatWi(member.wi)} of ${formatWi(member.wiCap)}`}
				/>
				<MetaLine
					as="span"
					size="xs"
					class="wsp-mcard__figure"
					items={["Workload", { text: load, tabular: true }]}
				/>
			</div>

			<MetaLine
				size="xs"
				items={[
					showStake && kind === "team" && {
						text: `Stake ${stakePercent(member.shareBp)}${member.shareHeld ? " (held)" : ""}`,
						tabular: true,
					},
					kind === "business" &&
					(member.spendLimitMinor === null ? "No personal spend ceiling" : "Spend ceiling set"),
					{ text: `Joined ${shortDate(member.joinedAt, referenceYear)}`, tabular: true },
				]}
			/>

			<OverrideLine facets={facets} class="wsp-mcard__overrides" />
		</article>
	);
}
// #endregion
