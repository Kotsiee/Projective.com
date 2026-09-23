import { assertEquals } from "@std/assert";
import {
	AssetPurpose,
	fitWithin,
	type MediaRef,
	MediaRefSchema,
	planTiers,
	refFor,
	VariantTier,
	variantObjectPath,
} from "./variants.ts";

Deno.test("fitWithin: scales the long edge down, keeps the aspect, never upscales", () => {
	assertEquals(fitWithin(4000, 3000, 1000), { width: 1000, height: 750 });
	assertEquals(fitWithin(300, 900, 480), { width: 160, height: 480 });
	assertEquals(fitWithin(200, 100, 1000), { width: 200, height: 100 });
	assertEquals(fitWithin(NaN, 0, 10), { width: 1, height: 1 });
});

Deno.test("planTiers: every tier exists, even for a source smaller than the largest target", () => {
	const t = planTiers("showcase", 1600, 1000);
	assertEquals(t.sm, { width: 480, height: 300 });
	assertEquals(t.md, { width: 1280, height: 800 });
	assertEquals(t.lg, { width: 1600, height: 1000 });
});

Deno.test("variantObjectPath: a tier sits beside its parent object", () => {
	assertEquals(variantObjectPath("u1/avatar/r9/full.webp", "sm"), "u1/avatar/r9/sm.webp");
	assertEquals(variantObjectPath("file.png", "lg"), "lg.webp");
});

Deno.test("vocabulary mirrors files.asset_purpose / files.variant_tier member-for-member", () => {
	assertEquals(AssetPurpose.options, ["library", "avatar", "showcase"]);
	assertEquals(VariantTier.options, ["sm", "md", "lg"]);
});

const REF: MediaRef = MediaRefSchema.parse({
	id: "a",
	bucket: "avatars",
	path: "u/avatar/r/full.webp",
	mime: "image/webp",
	width: 1400,
	height: 1400,
	variants: {
		md: { bucket: "avatars", path: "u/avatar/r/md.webp", width: 256, height: 256 },
		lg: { bucket: "avatars", path: "u/avatar/r/lg.webp", width: 1024, height: 1024 },
	},
});

Deno.test("refFor: the tier when present, else the nearest LARGER tier, else the original", () => {
	assertEquals(refFor(REF, "md").path, "u/avatar/r/md.webp");
	assertEquals(refFor(REF, "sm").path, "u/avatar/r/md.webp");
	assertEquals(refFor(REF, null).path, "u/avatar/r/full.webp");
	const bare = MediaRefSchema.parse({ id: "b", bucket: "avatars", path: "u/avatar.jpg", mime: "image/jpeg" });
	assertEquals(refFor(bare, "sm").path, "u/avatar.jpg");
});
