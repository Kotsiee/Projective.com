import type { JSX } from "preact";
import { RailFrame, type RailFrameProps } from "../components/RailFrame.tsx";

/**
 * HomeRail — the island wrapper that mounts {@link RailFrame} for the discovery Home.
 *
 * The module itself lives in `components/RailFrame.tsx` and is shared with the cross-category Search
 * Results feed. Only the HOST decides whether an island is needed: Home renders its sections from
 * `ExploreHome`, a SERVER component, so the rail needs a hydration root of its own here; the Results
 * feed renders the same frame from inside the already-hydrated `SearchDashboard`, where nesting a
 * second island would force its children — which carry the detail drawer's `onSelect` handler —
 * through props serialization for nothing.
 *
 * The wrapper keeps this file's public shape unchanged, so every `ExploreHome` call site and the
 * island discovery in `vite.config.ts` are untouched.
 */
export type HomeRailProps = RailFrameProps;

export default function HomeRail(props: HomeRailProps): JSX.Element {
	return <RailFrame {...props} />;
}
