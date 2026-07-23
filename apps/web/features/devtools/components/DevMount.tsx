import type { JSX } from "preact";
import type { UserContext } from "@projective/types/auth";
import { IS_DEV } from "@web/utils/dev.ts";
import DevTools from "../islands/DevTools.island.tsx";

// #region Props
/** Props for {@link DevMount}. */
export interface DevMountProps {
	/** The request's hydrated context, forwarded to the Dev Tools for the effective-context summary. */
	context?: UserContext;
}
// #endregion

/**
 * DevMount — the single, guarded entry point for the Developer Tools.
 *
 * Renders the {@link DevTools} island **only in development**. Because {@link IS_DEV} is Vite's
 * statically-replaced `import.meta.env.DEV`, `if (!IS_DEV) return null` becomes an unconditional
 * `return null` in a production build, so the bundler tree-shakes the `DevTools` import (and its entire
 * subtree) out of the shipped bundle. Paired with the Vite-config exclusion of `features/devtools/**`
 * from the island manifest, the Dev Tools are guaranteed absent from production.
 *
 * Mounted once, globally, in `routes/_app.tsx`, so the tools are available on every route (guest and
 * authenticated) during development.
 */
export function DevMount(props: DevMountProps): JSX.Element | null {
	if (!IS_DEV) return null;
	return <DevTools context={props.context} />;
}
