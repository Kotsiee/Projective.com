import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import type { UserContext } from "@projective/types/auth";
import {
	type ActingEnterprise,
	roleLabel as workspaceRoleLabel,
	type WorkspaceKind,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { TabMenu } from "@projective/ui/navigation";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";
import { canUseTeams } from "@web/features/shell/core/restricted-surfaces.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/** Props for {@link ContextSwitcherView}. */
export interface ContextSwitcherViewProps {
	effCtx: UserContext;
	displayName: string;
	avatarUrl?: string;
	/** The viewer's live teams and businesses, `null` per kind until read. */
	memberships: Readonly<Record<WorkspaceKind, readonly WorkspaceSummary[] | null>>;
	membershipsError: string | null;
	enterprises: readonly ActingEnterprise[] | null;
	switching: boolean;
	switchError: string | null;
	onBack: (event: JSX.TargetedMouseEvent<HTMLElement>) => void;
	onPersonal: () => void;
	onSwitch: (kind: "team" | "business" | "enterprise", id: string, handle: string) => void;
	onNavigate: () => void;
}

const KIND_TAB: Readonly<Record<WorkspaceKind, { label: string; noun: string; manage: string }>> = {
	team: { label: "Teams", noun: "teams", manage: "/teams" },
	business: { label: "Businesses", noun: "businesses", manage: "/businesses" },
};

const PANEL_ID = "shell-ctx-panel";

/**
 * ContextSwitcherView — the account popover's switcher: the person themself, then their Teams and
 * Businesses as two tabs (each with an icon-only Manage beside the tabs), then any Enterprises.
 * Choosing a row re-stamps the session through the caller's `onSwitch` / `onPersonal`.
 */
export function ContextSwitcherView(props: ContextSwitcherViewProps): JSX.Element {
	const { effCtx, memberships, enterprises, switching } = props;
	const restricted = effCtx.restricted;
	const kinds: WorkspaceKind[] = [
		...(canUseTeams(effCtx) ? ["team" as const] : []),
		...(restricted ? [] : ["business" as const]),
	];
	const startKind: WorkspaceKind = effCtx.contextType === "business" && kinds.includes("business")
		? "business"
		: kinds[0] ?? "team";
	const tab = useSignal<WorkspaceKind>(startKind);
	const kind = kinds.includes(tab.value) ? tab.value : startKind;
	const activeIndex = useSignal(Math.max(0, kinds.indexOf(kind)));
	const canCreateTeam = kinds.includes("team") && effCtx.contextType !== "enterprise";
	const canCreateBusiness = !restricted && effCtx.isFreelancer;

	const row = (
		key: string,
		mark: JSX.Element,
		name: string,
		detail: string,
		active: boolean,
		onPick: () => void,
	): JSX.Element => (
		<li key={key} role="none">
			<button
				type="button"
				class="ui-menu-item shell-ctx__item"
				data-active={active ? "true" : undefined}
				aria-current={active ? "true" : undefined}
				disabled={active || switching}
				onClick={onPick}
			>
				{mark}
				<span class="shell-ctx__body">
					<span class="shell-ctx__name">{name}</span>
					<span class="shell-ctx__detail">{detail}</span>
				</span>
				{active ? <NavIcon name="check" class="shell-ctx__check" /> : null}
			</button>
		</li>
	);

	const workspaceRows = (k: WorkspaceKind): JSX.Element | JSX.Element[] => {
		const list = memberships[k];
		if (list === null) {
			return (
				<li class="shell-ctx__empty" role="status">
					{props.membershipsError ?? `Loading your ${KIND_TAB[k].noun}…`}
				</li>
			);
		}
		if (list.length === 0) return <li class="shell-ctx__empty">No {KIND_TAB[k].noun} yet.</li>;
		return list.map((m) =>
			row(
				m.id,
				<Avatar label={m.name} image={m.avatar || undefined} size="sm" shape="square" />,
				m.name,
				`${workspaceRoleLabel(m.role)} · ${
					m.memberCount === 1 ? "1 member" : `${m.memberCount} members`
				}`,
				effCtx.contextType === k && effCtx.contextId === m.id,
				() => props.onSwitch(k, m.id, m.handle),
			)
		);
	};

	const create = kind === "team"
		? canCreateTeam ? { href: "/teams/create", label: "Create a team" } : null
		: canCreateBusiness
		? { href: "/businesses/create", label: "Create a business" }
		: null;

	return (
		<div class="shell-subview">
			<div class="shell-subview__head">
				<button
					type="button"
					class="shell-subview__back"
					aria-label="Back"
					onClick={props.onBack}
				>
					<NavIcon name="arrowLeft" />
				</button>
				<span class="shell-subview__title">Switch context</span>
			</div>

			<div class="shell-ctx" aria-busy={switching ? "true" : undefined}>
				<ul class="shell-ctx__list">
					{row(
						"personal",
						<UserAvatar label={props.displayName} image={props.avatarUrl} size="sm" />,
						props.displayName,
						`Personal · ${effCtx.isFreelancer ? "Freelancer" : "Client"}`,
						effCtx.contextType === "personal",
						props.onPersonal,
					)}
				</ul>

				{kinds.length > 0 && (
					<div class="shell-ctx__tabs">
						<div class="shell-ctx__tabbar">
							<TabMenu
								class="shell-ctx__tabmenu"
								aria-label="Workspaces"
								panelId={PANEL_ID}
								activeIndex={activeIndex}
								onActiveIndexChange={(i) => (tab.value = kinds[i] ?? startKind)}
								model={kinds.map((k) => ({ key: k, label: KIND_TAB[k].label }))}
							/>
							<Tooltip content={`Manage ${KIND_TAB[kind].noun}`} placement="bottom">
								<a
									class="ui-button ui-button--secondary ui-button--text ui-button--size-sm ui-button--rounded ui-button--icon-only shell-ctx__manage"
									href={KIND_TAB[kind].manage}
									aria-label={`Manage ${KIND_TAB[kind].noun}`}
									onClick={props.onNavigate}
								>
									<span class="ui-button__icon">
										<NavIcon name="settings" />
									</span>
								</a>
							</Tooltip>
						</div>
						<ul
							class="shell-ctx__list"
							id={PANEL_ID}
							role="tabpanel"
							aria-label={KIND_TAB[kind].label}
						>
							{workspaceRows(kind)}
						</ul>
					</div>
				)}

				{enterprises && enterprises.length > 0
					? (
						<section class="shell-ctx__section" aria-label="Enterprises">
							<div class="shell-ctx__section-head">
								<span class="shell-ctx__section-title">Enterprises</span>
							</div>
							<ul class="shell-ctx__list">
								{enterprises.map((o) =>
									row(
										o.id,
										<Avatar label={o.name} size="sm" shape="square" />,
										o.name,
										o.owner ? "Owner" : "Member",
										effCtx.contextType === "enterprise" && effCtx.contextId === o.id,
										() => props.onSwitch("enterprise", o.id, o.handle),
									)
								)}
							</ul>
						</section>
					)
					: null}
			</div>

			{(switching || props.switchError) && (
				<p class="shell-account__note" role="status" aria-live="polite">
					{switching ? "Switching…" : props.switchError}
				</p>
			)}

			{create && (
				<>
					<div class="ui-menu-separator" role="separator" />
					<a class="ui-menu-item shell-menu__item" href={create.href} onClick={props.onNavigate}>
						<span class="ui-menu-item__icon shell-menu__icon">
							<NavIcon name="create" />
						</span>
						<span class="shell-menu__label">{create.label}</span>
					</a>
				</>
			)}
		</div>
	);
}
