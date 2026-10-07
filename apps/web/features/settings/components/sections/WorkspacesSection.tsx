import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type { UserContext } from "@projective/types/auth";
import type {
	ActingOrganisation,
	WorkspaceKind,
	WorkspaceSummary,
} from "@projective/types/workspace";
import { WorkspaceService } from "@features/workspaces/core/WorkspaceService.ts";
import { useContextSwitch } from "@features/workspaces/core/useContextSwitch.ts";
import { OutLink, SaveStatus, SectionHead, SettingsBlock } from "../SettingsParts.tsx";
import { sectionEntries, sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Workspaces (Decision #150): who the session is acting as, and every team, business and
 * organisation the person can act for — read through the same roster routes the account popover's
 * switcher uses, switched through the same `useContextSwitch` sequence (switch → re-mint the token →
 * hard navigation), so "Act as" here and in the header can never behave differently. Creating and
 * managing a workspace stays on `/teams` and `/businesses`.
 */

type Lists = {
	team: WorkspaceSummary[] | null;
	business: WorkspaceSummary[] | null;
	organisations: ActingOrganisation[] | null;
};

const CONTEXT_LABEL: Readonly<Record<UserContext["contextType"], string>> = {
	personal: "Yourself",
	team: "A team",
	business: "A business",
	organisation: "An organisation",
};

export interface WorkspacesSectionProps {
	context: UserContext;
}

export function WorkspacesSection(props: WorkspacesSectionProps): JSX.Element {
	const meta = sectionMeta("workspaces");
	const lists = useSignal<Lists>({ team: null, business: null, organisations: null });
	const failed = useSignal<string | null>(null);
	const { switching, error, switchTo, exitToPersonal } = useContextSwitch();
	const ctx = props.context;
	const showsTeams = sectionEntries("workspaces", ctx).some((e) => e.anchor === "teams");

	useEffect(() => {
		let live = true;
		const roster = (kind: WorkspaceKind) => WorkspaceService.roster(kind);
		Promise.all([
			showsTeams ? roster("team") : Promise.resolve(null),
			roster("business"),
			WorkspaceService.actingOrganisations(),
		])
			.then(([teams, businesses, orgs]) => {
				if (!live) return;
				const keep = (items: WorkspaceSummary[]) =>
					items.filter((item) => item.status !== "archived");
				lists.value = {
					team: teams && teams.ok && teams.data ? keep(teams.data.items) : showsTeams ? null : [],
					business: businesses.ok && businesses.data ? keep(businesses.data.items) : null,
					organisations: orgs.ok && orgs.data ? orgs.data.organisations : null,
				};
				if (!businesses.ok) {
					failed.value = businesses.message ?? "Your workspaces couldn't be loaded just now.";
				}
			});
		return () => {
			live = false;
		};
	}, []);

	const actingId = ctx.contextType === "personal" ? null : ctx.contextId;

	function Row(
		row: {
			id: string;
			name: string;
			meta: string;
			href: string;
			type: "team" | "business" | "organisation";
			handle: string;
		},
	) {
		const acting = actingId === row.id;
		return (
			<li class="stg-ws__item" key={row.id}>
				<div class="stg-ws__main">
					<a class="stg-ws__name" href={row.href}>{row.name}</a>
					<span class="stg-ws__meta">{row.meta}</span>
				</div>
				{acting ? <span class="stg-pill stg-pill--primary">Acting as</span> : (
					<Button
						size="sm"
						variant="outlined"
						label="Act as"
						aria-label={`Act as ${row.name}`}
						loading={switching.value}
						onClick={() => switchTo(row.type, row.id, { handle: row.handle })}
					/>
				)}
			</li>
		);
	}

	function List(
		props2: {
			items: {
				id: string;
				name: string;
				meta: string;
				href: string;
				type: "team" | "business" | "organisation";
				handle: string;
			}[] | null;
			empty: string;
			label: string;
		},
	) {
		if (props2.items === null) {
			return (
				<p class="stg-note">
					{failed.value ? "This list couldn't be loaded just now." : "Loading…"}
				</p>
			);
		}
		if (props2.items.length === 0) return <p class="stg-note">{props2.empty}</p>;
		return <ul class="stg-ws" aria-label={props2.label}>{props2.items.map((item) => Row(item))}
		</ul>;
	}

	const roleMeta = (w: WorkspaceSummary) =>
		`${w.isOwner ? "Owner" : "Member"} · ${w.memberCount} ${
			w.memberCount === 1 ? "member" : "members"
		}`;
	const l = lists.value;

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			{failed.value ? <InlineNotice align="start" text={failed.value} /> : null}

			<SettingsBlock
				anchor="acting"
				title="Acting as"
				description="Everything you do — messages, purchases, projects — is done as this."
			>
				<div class="stg-ws__acting">
					<span class="stg-ws__acting-label">
						{CONTEXT_LABEL[ctx.contextType]}
						{ctx.contextType === "personal" ? "" : ctx.handle ? ` · @${ctx.handle}` : ""}
					</span>
					{ctx.contextType !== "personal"
						? (
							<Button
								size="sm"
								variant="text"
								label="Switch back to yourself"
								loading={switching.value}
								onClick={() => exitToPersonal()}
							/>
						)
						: null}
				</div>
				<SaveStatus
					state={error.value ? { tone: "error", text: error.value } : { tone: "idle", text: "" }}
				/>
			</SettingsBlock>

			{showsTeams
				? (
					<SettingsBlock
						anchor="teams"
						title="Teams"
						description="Micro-agency teams you run or belong to."
					>
						<List
							label="Your teams"
							empty="You're not in a team yet."
							items={l.team?.map((t) => ({
								id: t.id,
								name: t.name,
								meta: roleMeta(t),
								href: `/teams/${t.handle}`,
								type: "team" as const,
								handle: t.handle,
							})) ?? null}
						/>
						<OutLink href="/teams">Manage teams</OutLink>
					</SettingsBlock>
				)
				: null}

			<SettingsBlock
				anchor="businesses"
				title="Businesses"
				description="Client businesses you buy for."
			>
				<List
					label="Your businesses"
					empty="You're not part of a business yet."
					items={l.business?.map((b) => ({
						id: b.id,
						name: b.name,
						meta: roleMeta(b),
						href: `/businesses/${b.handle}`,
						type: "business" as const,
						handle: b.handle,
					})) ?? null}
				/>
				<OutLink href="/businesses">Manage businesses</OutLink>
			</SettingsBlock>

			<SettingsBlock anchor="organisations" title="Organisations">
				<List
					label="Your organisations"
					empty="You don't act for any organisation."
					items={l.organisations?.map((o) => ({
						id: o.id,
						name: o.name,
						meta: o.owner ? "Owner" : "Member",
						href: `/${o.handle}`,
						type: "organisation" as const,
						handle: o.handle,
					})) ?? null}
				/>
			</SettingsBlock>
		</div>
	);
}
