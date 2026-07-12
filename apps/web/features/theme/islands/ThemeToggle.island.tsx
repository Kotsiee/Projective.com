import { dsConfig, toggleMode } from "@projective/ui/system";

/**
 * Demo control — proves runtime theme mutation flows through the shared signal store to `:root`
 * across island boundaries. Reading `dsConfig.value` makes this island re-render on change. Replace
 * with the real appearance settings surface later.
 */
export default function ThemeToggle() {
	const mode = dsConfig.value.mode;
	return (
		<button
			type="button"
			class="theme-toggle"
			aria-label="Toggle color theme"
			onClick={() => toggleMode()}
		>
			{mode === "dark" ? "☾ Dark" : "☀ Light"}
		</button>
	);
}
