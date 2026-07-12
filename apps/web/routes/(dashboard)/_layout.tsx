import type { JSX } from "preact";
import { define } from "@web/utils/state.ts";
import { AppShell, MiddleNav, NavItem, PageCanvas, ShellSidebar } from "@projective/ui/navigation";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";
import MobileMenu from "@web/features/shell/islands/MobileMenu.island.tsx";
import MiddleNavSplitter from "@web/features/shell/islands/MiddleNavSplitter.island.tsx";

/** Global destinations — reused by the desktop sidebar and the mobile drawer. */
function GlobalNav({ path }: { path: string }): JSX.Element {
	const on = (p: string) => path === p || path.startsWith(`${p}/`);
	return (
		<>
			<NavItem href="/home" label="Home" icon="⌂" active={on("/home")} />
			<NavItem href="/projects" label="Projects" icon="▦" active={on("/projects")} />
			<NavItem href="/messages" label="Messages" icon="✉" active={on("/messages")} />
			<NavItem href="/wallet" label="Wallet" icon="◈" active={on("/wallet")} />
			<NavItem href="/teams" label="Teams" icon="⧉" active={on("/teams")} />
			<NavItem href="/business" label="Businesses" icon="⌂" active={on("/business")} />
		</>
	);
}

/**
 * Dashboard shell — the full nested matrix (DESIGN_SYSTEM.md Part D): Red `AppShell` (top bar +
 * global sidebar) frames the Blue `MiddleNav` lane (drag-resizable), which frames the Green
 * `PageCanvas`. Guest/mobile gates are handled inside the shell components.
 */
export default define.page(function DashboardLayout(ctx) {
	const path = ctx.url.pathname;
	return (
		<AppShell
			persona="user"
			brand={<span class="brand">Projective</span>}
			mobileMenu={<MobileMenu label="Navigation">{<GlobalNav path={path} />}</MobileMenu>}
			utilityBar={<ThemeToggle />}
			sidebar={
				<ShellSidebar
					footer={
						<NavItem href="/settings" label="Settings" icon="⚙" active={path === "/settings"} />
					}
				>
					<GlobalNav path={path} />
				</ShellSidebar>
			}
		>
			<MiddleNav
				lane={
					<MiddleNavSplitter>
						<nav class="lane-nav" aria-label="Section">
							<NavItem href="/messages" label="Inbox" icon="✉" />
							<NavItem href="/projects" label="All projects" icon="▦" />
							<NavItem href="/services" label="Services" icon="◷" />
						</nav>
					</MiddleNavSplitter>
				}
			>
				<PageCanvas>
					<ctx.Component />
				</PageCanvas>
			</MiddleNav>
		</AppShell>
	);
});
