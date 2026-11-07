import { assertEquals } from "@std/assert";
import type { AssetMetadata } from "@projective/types/files";
import { type ThumbAsset, type ThumbJob, thumbPlan, wavePath } from "./thumb-plan.ts";

const ID = "00000000-0000-4000-8000-000000000001";

function asset(name: string, extra: Partial<ThumbAsset> = {}): ThumbAsset {
	return {
		id: ID,
		name,
		kind: "file",
		ext: name.split(".").pop() ?? "",
		source: "supabase",
		status: "uploaded",
		url: "#",
		thumbnailUrl: null,
		sizeBytes: 2048,
		contentHash: "abc",
		metadata: undefined,
		...extra,
	};
}

function job(name: string, extra: Partial<ThumbAsset> = {}): ThumbJob {
	const plan = thumbPlan(asset(name, extra), true);
	if (plan.kind !== "render") throw new Error(`${name} planned ${plan.kind}`);
	return plan;
}

function media(value: unknown): AssetMetadata {
	return { media: value } as AssetMetadata;
}

Deno.test("each type goes to its renderer, on a lane that matches its cost", () => {
	const cases: [string, string, string][] = [
		["notes.md", "text", "net"],
		["main.ts", "text", "net"],
		["data.csv", "csv", "net"],
		["book.xlsx", "sheet", "decode"],
		["old.xls", "sheet", "decode"],
		["paper.pdf", "pdf", "decode"],
		["letter.docx", "docx", "decode"],
		["deck.pptx", "pptx", "decode"],
		["clip.mp4", "video", "decode"],
		["chair.glb", "model", "gpu"],
		["sky.hdr", "texture", "decode"],
		["sky.exr", "texture", "decode"],
	];
	for (const [name, renderer, lane] of cases) {
		const plan = job(name);
		assertEquals([plan.renderer, plan.lane], [renderer, lane], name);
	}
});

Deno.test("what is already on the row beats reading the file", () => {
	assertEquals(
		thumbPlan(asset("a.mp3", { metadata: media({ kind: "audio", peaks: [0.5, 1] }) }), true),
		{ kind: "wave", peaks: [0.5, 1] },
	);
	assertEquals(
		thumbPlan(
			asset("a.mp4", { metadata: media({ kind: "video", posterDataUrl: "data:image/jpeg;x" }) }),
			true,
		),
		{ kind: "picture", src: "data:image/jpeg;x" },
	);
	assertEquals(
		thumbPlan(
			asset("a.pdf", { metadata: media({ kind: "document", posterDataUrl: "data:image/png;x" }) }),
			true,
		),
		{ kind: "picture", src: "data:image/png;x" },
	);
});

Deno.test("a video with a stored poster and a plain image stay with the card's own picture", () => {
	assertEquals(
		thumbPlan(asset("a.mp4", { kind: "video", thumbnailUrl: "/poster.webp" }), true),
		{ kind: "none" },
	);
	assertEquals(thumbPlan(asset("a.png", { kind: "image" }), true), { kind: "none" });
});

Deno.test("an audio row with no peaks keeps its tile", () => {
	assertEquals(thumbPlan(asset("a.mp3", { metadata: media({ kind: "audio", peaks: [] }) }), true), {
		kind: "none",
	});
});

Deno.test("nothing is read for bytes the platform does not hold or has not finished checking", () => {
	assertEquals(thumbPlan(asset("a.pdf", { status: "scanning" }), true), { kind: "none" });
	assertEquals(thumbPlan(asset("a.pdf", { source: "link" }), true), { kind: "none" });
	assertEquals(thumbPlan(asset("empty.csv", { sizeBytes: 0 }), true), { kind: "none" });
});

Deno.test("a connector's own preview is shown for a file with no stored bytes", () => {
	assertEquals(
		thumbPlan(asset("a.pdf", { source: "google_drive", thumbnailUrl: "https://t/x" }), true),
		{ kind: "picture", src: "https://t/x" },
	);
});

Deno.test("whole-file renderers stop at their limits; ranged ones do not", () => {
	assertEquals(thumbPlan(asset("a.glb", { sizeBytes: 40_000_000 }), true), { kind: "none" });
	assertEquals(thumbPlan(asset("a.xlsx", { sizeBytes: 20_000_000 }), true), { kind: "none" });
	assertEquals(job("a.pdf", { sizeBytes: 900_000_000 }).renderer, "pdf");
	assertEquals(job("a.pptx", { sizeBytes: 900_000_000 }).renderer, "pptx");
});

Deno.test("3D waits for a page whose policy admits its decoders", () => {
	assertEquals(thumbPlan(asset("a.glb"), false), { kind: "none" });
	assertEquals(job("a.pdf").renderer, "pdf");
});

Deno.test("the key changes with the content, and a row without a hash falls back to its size", () => {
	assertEquals(job("a.pdf").key, `${ID}:abc:v1`);
	assertEquals(job("a.pdf", { contentHash: null }).key, `${ID}:2048:v1`);
});

Deno.test("a waveform keeps each span's loudest peak and never draws a bar of nothing", () => {
	assertEquals(wavePath([1, 0.2], 2), "M0.5 0.000V1.000M1.5 0.400V0.600");
	assertEquals(wavePath([0.2, 0.8, 0.1, 0.4], 2), "M0.5 0.100V0.900M1.5 0.300V0.700");
	assertEquals(wavePath([0], 1), "M0.5 0.470V0.530");
	assertEquals(wavePath([]), "");
});

Deno.test("a message-attached row reads its bytes by the file's id, not the link's", () => {
	const file = "00000000-0000-4000-8000-000000000002";
	const plan = job("a.pdf", { id: "link-row", assetId: file });
	assertEquals(plan.key.startsWith(file), true);
	assertEquals(plan.src.includes(file), true);
});
