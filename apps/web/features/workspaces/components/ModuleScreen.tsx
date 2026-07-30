import type { JSX } from "preact";
import {
	kindCopy,
	walletHrefFor,
	type WorkspaceDetail,
	workspaceHref,
} from "@projective/types/workspace";
import { moduleFor, type ModuleKey } from "../core/module-registry.tsx";
import { ModulePlaceholder } from "./ModulePlaceholder.tsx";
import WorkspaceOverview from "../islands/WorkspaceOverview.island.tsx";
import MembersScreen from "../islands/MembersScreen.island.tsx";
import RolesMatrix from "../islands/RolesMatrix.island.tsx";
import PayoutPolicyScreen from "../islands/PayoutPolicyScreen.island.tsx";
import SpendPolicyScreen from "../islands/SpendPolicyScreen.island.tsx";

/**
 * ModuleScreen — the single dispatcher from a module key to its body.
 *
 * Every `/teams/[id]/[module]` and `/businesses/[id]/[module]` route funnels through here, so the two
 * kinds share one body table rather than two parallel switch statements that drift. A module with a
 * real screen gets it; a module that DELEGATES to an existing surface (`/projects`, `/catalogue`,
 * `/messages`, `/wallet`) gets a placeholder that hands off rather than a second implementation of
 * that surface; a module that is genuinely next says so plainly.
 *
 * The dispatcher is deliberately dumb about permissions: `resolveWorkspaceConsole` has already
 * corrected the module key to one the viewer may open, so by the time we are here the question is
 * settled. Re-checking would either be redundant or, worse, disagree.
 */

export interface ModuleScreenProps {
	workspace: WorkspaceDetail;
	module: ModuleKey;
	/** The resolved `?view=` sub-view, when the module has tabs. */
	view?: string | null;
}

/** Render the body for one module. */
export function ModuleScreen(props: ModuleScreenProps): JSX.Element {
	const { workspace: ws, module } = props;
	const copy = kindCopy(ws.kind);
	const mod = moduleFor(module);

	switch (module) {
		case "overview":
			return <WorkspaceOverview workspace={ws} />;

		case "members":
		case "invitations":
			return <MembersScreen workspace={ws} view={props.view ?? null} module={module} />;

		case "roles":
			return <RolesMatrix workspace={ws} />;

		case "payouts":
			return ws.payout
				? <PayoutPolicyScreen workspace={ws} policy={ws.payout} />
				: (
					<ModulePlaceholder
						kind={ws.kind}
						module={mod!}
						note="This entity has no payout policy."
					/>
				);

		case "spend":
			return ws.spend ? <SpendPolicyScreen workspace={ws} policy={ws.spend} /> : (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod!}
					note="This entity has no spend policy."
				/>
			);

		// --- Modules that DELEGATE to a surface that already exists -----------------------------------
		case "finance":
			return (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod!}
					href={walletHrefFor(ws.kind, ws.id)}
					linkLabel={`Open the ${copy.moneyNoun}`}
					note={`Balances, movements and statements for ${ws.name} live in the wallet, scoped to this ${copy.noun}.`}
				/>
			);
		case "projects":
			return (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod!}
					href="/projects"
					linkLabel="Open projects"
					note={ws.kind === "team"
						? `Engagements ${ws.name} is delivering, in the projects surface.`
						: `Engagements ${ws.name} has commissioned, in the projects surface.`}
				/>
			);
		case "catalogue":
			return (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod!}
					href="/catalogue"
					linkLabel="Open catalogue"
					note={`Services and products offered by ${ws.name}.`}
				/>
			);
		case "messages":
			return (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod!}
					href="/messages"
					linkLabel="Open messages"
					note={`Conversations involving ${ws.name}.`}
				/>
			);
		case "calendar":
			return (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod!}
					href={`/@${ws.handle}/availability`}
					linkLabel="Open the calendar"
					note={`Sessions, deadlines and availability for ${ws.name}.`}
				/>
			);
		case "profile":
			return (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod!}
					href={`/@${ws.handle}`}
					linkLabel="Open the public profile"
					note="Banner, story, skills and reviews are edited on the public profile itself, so there is only ever one version of them."
				/>
			);

		// --- Modules that are next -------------------------------------------------------------------
		default:
			return (
				<ModulePlaceholder
					kind={ws.kind}
					module={mod ?? {
						key: module,
						label: "Section",
						group: "Admin",
						glyph: <span />,
						kinds: ["team", "business"],
						permission: () => null,
						blurb: "",
					}}
					note={module === "settings"
						? `Identity, handle, notification defaults and archiving for ${ws.name}.`
						: undefined}
					href={module === "verification" ? workspaceHref(ws.kind, ws.id, "settings") : null}
					linkLabel={module === "verification" ? "Open settings" : undefined}
				/>
			);
	}
}
