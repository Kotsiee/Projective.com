/**
 * dev.ts — the single build-time development flag for the web app.
 *
 * `IS_DEV` is derived from Vite's statically-replaced `import.meta.env.DEV`. Because Vite substitutes
 * that expression with a boolean **literal** at build time (both the client and the SSR bundle pass
 * through Vite — `ssr.noExternal: true`), every `if (IS_DEV)` / `IS_DEV && …` branch becomes dead code
 * in a production build and is dropped by the bundler's tree-shaking. This is the linchpin of the
 * Developer-Tools production guardrail: the dev-only overlay, its event listeners, and its in-memory
 * log cache do not merely *no-op* in production — they are **eliminated from the shipped bundle**.
 *
 * Do NOT replace this with a runtime check (`location.hostname === "localhost"`, an env fetch, …): a
 * runtime check cannot be tree-shaken, so the dev code would still ship. Keep the literal
 * `import.meta.env.DEV` reference intact so Vite can see and replace it.
 */

// The web app is always built by Vite, which injects `import.meta.env`. Declare the shape so a plain
// `deno check` (which does not run the Vite transform) still type-checks this reference.
declare global {
	interface ImportMetaEnv {
		/** `true` in `vite`/`vite dev`, `false` in `vite build` (production). */
		readonly DEV: boolean;
		/** The inverse of {@link DEV}. */
		readonly PROD: boolean;
		/** The active mode string (`"development"` | `"production"` | a custom `--mode`). */
		readonly MODE: string;
	}
	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}
}

/** `true` only in development builds. Statically eliminable — gate every dev-only branch on it. */
export const IS_DEV: boolean = import.meta.env.DEV === true;
