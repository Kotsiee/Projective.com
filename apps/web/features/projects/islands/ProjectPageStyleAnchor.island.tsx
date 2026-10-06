import "../styles/project-setup.css";
import "../styles/project-dashboard.css";

/**
 * The bundling site for the engagement's two body stylesheets — the Overview's
 * (`project-dashboard.css`, `/projects/[slug]`) and the configuration's (`project-setup.css`,
 * `/projects/[slug]/details`).
 *
 * Both bodies are SERVER components, and the Vite build collects CSS side-effect imports from the
 * ISLAND graph only — never from the SSR render. So `import "…css"` inside
 * `ProjectOverviewScreen.tsx` or `ProjectSetupScreen.tsx` reaches nothing, and the surface ships
 * with correct markup and no rules. In dev this is invisible: Vite serves a `<link>` from the SSR
 * graph anyway, so the failure only appears in a production build.
 *
 * The three setup ISLANDS do import `project-setup.css`, which covers the form — but not the two
 * paths where none of them render: the not-found branch, and the Overview, whose only importer of
 * `project-dashboard.css` is a server component. This anchor closes both, and it also carries the
 * Overview's header and footer bands, which share that sheet.
 *
 * One anchor for both sheets rather than one each: the two bodies are the engagement's two own pages,
 * so whichever renders, the same island is on the page and the bundler emits the pair together.
 * Same pattern as `ShowcaseStyleAnchor` / explore's `CardStyleAnchor` / view's `ViewStyleAnchor`.
 *
 * Renders nothing and hydrates to nothing — the module graph is the entire point.
 */
export default function ProjectPageStyleAnchor(): null {
	return null;
}
