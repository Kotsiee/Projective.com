import type { ComponentChildren, JSX } from "preact";
import "../styles/app-shell.css";
import { cx } from "../../core/cx.ts";
import { ShellTopBar } from "./ShellTopBar.tsx";
import type { Persona } from "../types/mod.ts";

export interface AppShellProps {
	/**
	 * Visibility gate (DESIGN_SYSTEM.md Part D). `user` shows the Red-zone sidebar (full nested
	 * matrix); `guest` hides it — the top bar goes glass and frames the canvas directly.
	 */
	persona?: Persona;
	/** Brand/wordmark for the top bar's leading edge. */
	brand?: ComponentChildren;
	/** Mobile menu trigger (island) — shown in the top bar's leading edge on small screens. */
	mobileMenu?: ComponentChildren;
	/** Centered micro search bar for the top bar (mobile). */
	search?: ComponentChildren;
	/** Trailing top-bar actions (notifications, theme toggle, avatar). */
	utilityBar?: ComponentChildren;
	/** Red-zone global sidebar content (user persona, desktop). */
	sidebar?: ComponentChildren;
	/**
	 * Chrome density (DESIGN_SYSTEM.md Part D.6). `full` is the standard L-shell. `focus` is the
	 * **distraction-free** mode a linear, committing flow runs in — checkout's Details and Payment
	 * steps — where every navigational exit is removed so the only paths are forward and back.
	 *
	 * It is a **declaration, not a set of overrides**: the mode stamps `data-chrome` on the shell root
	 * and the caller simply passes no `sidebar` and no lane. Nothing is hidden with `display: none`,
	 * because chrome that is present-but-invisible still takes part in the frame-inset accumulator and
	 * still reserves its grid track — which is how a "hidden" 280px lane leaves a 280px hole.
	 *
	 * `bare` goes one step further, for a page that is itself framed by another surface (the
	 * catalogue's buyer simulation inside the item workspace's Preview `<iframe>`): no top bar either,
	 * so the content is the whole viewport with no rails, no shell bands and no frame seam.
	 */
	chrome?: ShellChrome;
	/**
	 * The `id` of the page's main landmark — `PageCanvas` renders it as `main-content`. When set, the
	 * shell's FIRST focusable element is a "Skip to content" link to it, hidden until it takes keyboard
	 * focus (WCAG 2.4.1). Without it a keyboard user crosses the top bar, the global rail and the
	 * middle-nav lane — fifty-odd stops on a project page — before reaching anything the page is about.
	 */
	skipTo?: string;
	/** Nested content — a MiddleNav (Blue) or a PageCanvas (Green). */
	children?: ComponentChildren;
}

/** See {@link AppShellProps.chrome}. */
export type ShellChrome = "full" | "focus" | "bare";

/**
 * AppShell — the permanent outermost layout (Red zone). Provides the top utility bar and, for the
 * `user` persona on desktop, the narrow global sidebar. Its content region applies the gutter that
 * reveals the Red track behind the nested Blue/Green frames.
 */
export function AppShell(props: AppShellProps): JSX.Element {
	const {
		persona = "user",
		brand,
		mobileMenu,
		search,
		utilityBar,
		sidebar,
		chrome = "full",
		skipTo,
		children,
	} = props;
	// The rail is shown when the persona has one AND there is something to put in it. Keying on the
	// persona alone reserved the `sidebar` grid track for a caller that passed no content, leaving a
	// 64px empty column — and, worse, left `--shell-frame-inset-inline` accounting for a rail that was
	// not on screen, so the nested frame's fixed corner seam sat 64px inboard of the frame it traces.
	const bare = chrome === "bare";
	const showSidebar = persona === "user" && !!sidebar && !bare;
	return (
		<div
			class={cx(
				"ui-app-shell",
				persona === "guest" ? "ui-app-shell--guest" : "ui-app-shell--user",
				!showSidebar && "ui-app-shell--no-sidebar",
			)}
			data-chrome={chrome === "full" ? undefined : chrome}
		>
			{
				/* Out of flow (`position: fixed`), so it takes no cell of the shell's grid; first in the
				   DOM, so it is the first Tab stop on the page. */
			}
			{skipTo && !bare
				? <a class="ui-app-shell__skip" href={`#${skipTo}`}>Skip to content</a>
				: null}
			{bare ? null : (
				<ShellTopBar
					glass={persona === "guest"}
					brand={
						<>
							{mobileMenu ? <span class="ui-app-shell__mobile-menu">{mobileMenu}</span> : null}
							{brand}
						</>
					}
					center={search}
				>
					{utilityBar}
				</ShellTopBar>
			)}
			{showSidebar ? <div class="ui-app-shell__sidebar">{sidebar}</div> : null}
			<div class="ui-app-shell__content">{children}</div>
		</div>
	);
}
