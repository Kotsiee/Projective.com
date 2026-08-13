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
	 */
	chrome?: ShellChrome;
	/** Nested content — a MiddleNav (Blue) or a PageCanvas (Green). */
	children?: ComponentChildren;
}

/** See {@link AppShellProps.chrome}. */
export type ShellChrome = "full" | "focus";

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
		children,
	} = props;
	// The rail is shown when the persona has one AND there is something to put in it. Keying on the
	// persona alone reserved the `sidebar` grid track for a caller that passed no content, leaving a
	// 64px empty column — and, worse, left `--shell-frame-inset-inline` accounting for a rail that was
	// not on screen, so the nested frame's fixed corner seam sat 64px inboard of the frame it traces.
	const showSidebar = persona === "user" && !!sidebar;
	return (
		<div
			class={cx(
				"ui-app-shell",
				persona === "guest" ? "ui-app-shell--guest" : "ui-app-shell--user",
				!showSidebar && "ui-app-shell--no-sidebar",
			)}
			data-chrome={chrome === "focus" ? "focus" : undefined}
		>
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
			{showSidebar ? <div class="ui-app-shell__sidebar">{sidebar}</div> : null}
			<div class="ui-app-shell__content">{children}</div>
		</div>
	);
}
