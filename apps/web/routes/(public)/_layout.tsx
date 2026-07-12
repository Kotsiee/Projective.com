import { define } from "@web/utils/state.ts";
import { AppShell, PageCanvas } from "@projective/ui/navigation";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";

/**
 * Public shell — guest persona (DESIGN_SYSTEM.md Part D). The Red sidebar hides; the top bar goes
 * glass and frames the full-width Green canvas directly. No session required.
 */
export default define.page(function PublicLayout({ Component }) {
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
