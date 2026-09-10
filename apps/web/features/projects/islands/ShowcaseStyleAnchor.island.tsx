// The preview chrome lives in server components, whose CSS side-effect imports the Vite build does
// NOT collect (only island imports are). This zero-UI island is the reliable bundling site for the
// preview stylesheet on the `/projects/[id]` Preview — mirroring the explore `CardStyleAnchor` / view
// `ViewStyleAnchor` pattern (root memory "server-component CSS must ride an island"). It renders
// nothing and hydrates to nothing.
import "../styles/project-showcase.css";

export default function ShowcaseStyleAnchor(): null {
	return null;
}
