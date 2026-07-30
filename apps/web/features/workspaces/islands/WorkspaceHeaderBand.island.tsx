import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import {
	kindCopy,
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { moduleFor, type ModuleKey } from "../core/module-registry.tsx";
import { type ModuleTab, moduleTabsFor, toModuleTab } from "../core/workspace-model.ts";
import { EntityMark } from "../components/EntityMark.tsx";
import {
	ArchiveGlyph,
	BellGlyph,
	cloneGlyph,
	ExitGlyph,
	KebabGlyph,
	LinkGlyph,
	ShareGlyph,
} from "../core/workspace-glyphs.tsx";

/**
 * WorkspaceHeaderBand — the middle-nav frame's header strip on a `/teams/[id]` or `/businesses/[id]`
 * route.
 *
 * It carries three things and refuses a fourth: the section title, a compact entity identity so the
 * acting context is never ambiguous, and the module's sub-view tabs. Primary actions live in the
 * FOOTER band — putting a Save or an Invite up here as well is how a surface ends up with two places
 * to do the same thing and users learning neither.
 *
 * **Tabs are real anchors, underlined text, never pills** (§D.4): the URL owns active state, so a tab
 * survives a reload and can be opened in a new tab. Each label sits in its own `<span>` because the
 * mobile rule hides the words and keeps the row — a bare text node cannot be targeted by CSS.
 *
 * The band is mounted into a shell slot, so it must not export its intrinsic width to the page; the
 * `overflow: hidden` + `max-inline-size: 100%` that prevents that lives in `workspace-chrome.css`.
 */

export interface WorkspaceHeaderBandProps {
	kind: WorkspaceKind;
	workspace: WorkspaceDetail;
	/** The module being rendered, already corrected server-side by `resolveWorkspaceConsole`. */
	module: ModuleKey;
	/** The raw `?view=` value, resolved against the module's tab set. */
	view?: string | null;
	/** Live pathname — reserved for future within-module wayfinding. */
	path: string;
}

export default function WorkspaceHeaderBand(props: WorkspaceHeaderBandProps): JSX.Element {
	const { workspace, kind, module } = props;
	const copy = kindCopy(kind);
	const mod = moduleFor(module);
	const menuOpen = useSignal(false);
	const menuRef = useRef<HTMLButtonElement | null>(null);

	const tabs = useComputed<ModuleTab[]>(() => moduleTabsFor(module, kind));
	const activeView = useComputed(() => toModuleTab(module, kind, props.view ?? null));
	const base = workspaceHref(kind, workspace.id, module);

	/** Copy the entity's public address. Fails silently — a clipboard refusal is not worth a dialog. */
	async function copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(
				`${globalThis.location?.origin ?? ""}/@${workspace.handle}`,
			);
		} catch { /* clipboard unavailable — nothing useful to say about it */ }
		menuOpen.value = false;
	}

	return (
		<div class="wsp-headerband" data-kind={kind}>
			<h2 class="wsp-headerband__name">{mod?.label ?? copy.Noun}</h2>

			<span class="wsp-headerband__divider" aria-hidden="true" />

			{/* The compact identity: whose workspace this is, always visible, never a guess. */}
			<a class="wsp-headerband__identity" href={workspaceHref(kind, workspace.id)}>
				<EntityMark
					kind={kind}
					name={workspace.name}
					handle={workspace.handle}
					image={workspace.avatar}
					size="sm"
				/>
				<span class="wsp-headerband__handle">{workspace.name}</span>
			</a>

			{workspace.isActing && (
				<Tooltip content={`You are acting as ${workspace.name}`} placement="bottom">
					<span class="wsp-headerband__badge">
						<span class="wsp-actingchip__dot" aria-hidden="true" />
						<span class="wsp-headerband__tab-label">Acting</span>
					</span>
				</Tooltip>
			)}

			{tabs.value.length > 1 && (
				<nav class="wsp-headerband__tabs" aria-label={`${mod?.label ?? "Section"} views`}>
					{tabs.value.map((t, i) => {
						const on = activeView.value === t.value;
						// The default view addresses the bare module URL, so the canonical address of a
						// module's landing view has no redundant query string on it.
						const href = i === 0 ? base : `${base}?view=${t.value}`;
						return (
							<a
								key={t.value}
								class="wsp-headerband__tab"
								href={href}
								data-active={on ? "true" : undefined}
								aria-current={on ? "page" : undefined}
							>
								<span class="wsp-headerband__tab-label">{t.label}</span>
							</a>
						);
					})}
				</nav>
			)}

			<span class="wsp-footerrig__spacer" />

			<div class="wsp-headerband__controls">
				<Tooltip content="Notification settings" placement="bottom">
					<a
						class="wsp-headerband__icon"
						href={workspaceHref(kind, workspace.id, "settings")}
						aria-label="Notification settings"
					>
						{cloneGlyph(BellGlyph)}
					</a>
				</Tooltip>

				<Popover
					open={menuOpen}
					targetRef={menuRef}
					placement="bottom-end"
					avoid={[".ui-app-shell__sidebar"]}
					class="wsp-headerband__panel"
				>
					<a class="wsp-footerrig__action" href={`/@${workspace.handle}`}>
						<span class="wsp-footerrig__glyph" aria-hidden="true">{cloneGlyph(ShareGlyph)}</span>
						Share public profile
					</a>
					<button type="button" class="wsp-footerrig__action" onClick={copyLink}>
						<span class="wsp-footerrig__glyph" aria-hidden="true">{cloneGlyph(LinkGlyph)}</span>
						Copy link
					</button>
					<a class="wsp-footerrig__action" href={workspaceHref(kind, workspace.id, "members")}>
						<span class="wsp-footerrig__glyph" aria-hidden="true">{cloneGlyph(ExitGlyph)}</span>
						Leave {copy.noun}
					</a>
					<a class="wsp-footerrig__action" href={workspaceHref(kind, workspace.id, "settings")}>
						<span class="wsp-footerrig__glyph" aria-hidden="true">{cloneGlyph(ArchiveGlyph)}</span>
						Archive…
					</a>
					<p class="wsp-headerband__panel-note">
						Nothing is ever deleted — archiving hides it and keeps the record.
					</p>
				</Popover>

				<Tooltip content={`${copy.Noun} actions`} placement="bottom">
					<button
						type="button"
						ref={menuRef}
						class="wsp-headerband__icon"
						aria-label={`${copy.Noun} actions`}
						aria-haspopup="menu"
						aria-expanded={menuOpen.value}
						onClick={() => {
							menuOpen.value = !menuOpen.value;
						}}
					>
						{cloneGlyph(KebabGlyph)}
					</button>
				</Tooltip>
			</div>
		</div>
	);
}
