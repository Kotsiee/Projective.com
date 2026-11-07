import { assertEquals } from "@std/assert";
import { fileFamily } from "./families.ts";
import { type FileSoftware, fileSoftware } from "./software.ts";

const BRIEF: Readonly<Record<FileSoftware, readonly string[]>> = {
	photoshop: ["psd", "psb"],
	illustrator: ["ai", "ait"],
	premiere: ["prproj"],
	aftereffects: ["aep", "aet"],
	indesign: ["indd", "indt"],
	lightroom: ["lrcat"],
	figma: ["fig", "jam"],
	sketch: ["sketch"],
	blender: ["blend", "blend1"],
	maya: ["mb", "ma"],
	max: ["max"],
	autocad: ["dwg", "dxf"],
	cinema4d: ["c4d"],
	zbrush: ["zpr", "ztl"],
	unity: ["unity", "prefab", "asset"],
	unreal: ["uproject", "uasset"],
	resolve: ["drp"],
	ableton: ["als"],
	protools: ["ptx"],
};

Deno.test("every extension the brief names lands on its application", () => {
	for (const [software, extensions] of Object.entries(BRIEF)) {
		for (const ext of extensions) assertEquals(fileSoftware({ ext }), software, ext);
	}
});

Deno.test("an extension reads the same in any case and with stray padding", () => {
	assertEquals(fileSoftware({ ext: "PSD" }), "photoshop");
	assertEquals(fileSoftware({ ext: " Blend " }), "blender");
});

Deno.test("a link is never an application, whatever its address ends in", () => {
	assertEquals(fileSoftware({ ext: "psd", source: "link" }), null);
	assertEquals(fileSoftware({ ext: "fig", kind: "link" }), null);
});

Deno.test("an extension no application owns names none", () => {
	assertEquals(fileSoftware({ ext: "" }), null);
	assertEquals(fileSoftware({ ext: "png" }), null);
	assertEquals(fileSoftware({ ext: "obj" }), null);
});

Deno.test("naming the application leaves the family alone", () => {
	assertEquals(fileFamily({ ext: "psd" }), "image");
	assertEquals(fileFamily({ ext: "blend" }), "model");
});
