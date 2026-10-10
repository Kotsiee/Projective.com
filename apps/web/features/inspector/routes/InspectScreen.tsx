import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { cspHeaderFor } from "@web/utils/csp.ts";
import { resolveInspect, shareParam } from "../core/inspector-ssr.ts";
import InspectorWorkspace from "../islands/InspectorWorkspace.island.tsx";
import InspectorUnavailable from "../islands/InspectorUnavailable.island.tsx";

/**
 * `/inspect/[fileId]` — the shell-free file inspector (Decision #161). Thin controller: resolve the
 * file as the viewer, then hand the island plain props.
 *
 * Every outcome carries the same headers: the inspector CSP profile (WASM decoders, blob fetches),
 * `noindex`, `no-referrer` (a `?share=` slug is a credential in the URL) and `no-store`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		const share = shareParam(ctx.url.searchParams.get("share"));
		const { asset, status } = await resolveInspect(ctx.params.fileId ?? "", share, actor);

		ctx.state.title = asset ? `${asset.name} · Projective` : "File not available · Projective";
		return page({ asset, signedIn: actor.userId.length > 0 }, {
			status,
			headers: {
				"content-security-policy": cspHeaderFor("inspector"),
				"x-robots-tag": "noindex, nofollow",
				"referrer-policy": "no-referrer",
				"cache-control": "private, no-store",
			},
		});
	},
});

export default define.page<typeof handler>(function InspectScreen({ data }) {
	return data.asset
		? <InspectorWorkspace asset={data.asset} signedIn={data.signedIn} />
		: <InspectorUnavailable signedIn={data.signedIn} />;
});
