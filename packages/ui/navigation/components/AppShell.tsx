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
	/** Nested content — a MiddleNav (Blue) or a PageCanvas (Green). */
	children?: ComponentChildren;
}

/**
 * AppShell — the permanent outermost layout (Red zone). Provides the top utility bar and, for the
 * `user` persona on desktop, the narrow global sidebar. Its content region applies the gutter that
 * reveals the Red track behind the nested Blue/Green frames.
 */
export function AppShell(props: AppShellProps): JSX.Element {
	const { persona = "user", brand, mobileMenu, search, utilityBar, sidebar, children } = props;
	const showSidebar = persona === "user";
	return (
		<div
			class={cx(
				"ui-app-shell",
				persona === "guest" ? "ui-app-shell--guest" : "ui-app-shell--user",
				!showSidebar && "ui-app-shell--no-sidebar",
			)}
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
