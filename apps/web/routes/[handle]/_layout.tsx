import { define } from "@web/utils/state.ts";
import { AppShell, PageCanvas } from "@projective/ui/navigation";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";

/**
 * Public profile shell for the wildcard handle namespace (/:handle). Guest persona (glass top bar,
 * no global sidebar) — one shell serves individual users, teams, and corporations; the entity type
 * resolves from the `@handle`. Reserved handles are claimed by static routes first (see
 * documentation/architecture/ROUTING.md). The profile header (avatar 1:1, banner 7:2) and tab bar
 * render inside the canvas.
 */
export default define.page(function ProfileLayout({ Component }) {
	return (
		<AppShell
			persona="guest"
			brand={<span class="brand">Projective</span>}
			utilityBar={<ThemeToggle />}
		>
			<PageCanvas>
				<Component />
			</PageCanvas>
		</AppShell>
	);
});
