import { assertEquals } from "@std/assert";
import { archiveFormat } from "./archive-read.ts";

Deno.test("the listing format comes from the file's name, double extension included", () => {
	assertEquals(archiveFormat("Brand kit.ZIP"), "zip");
	assertEquals(archiveFormat("release.tar"), "tar");
	assertEquals(archiveFormat("release.tar.gz"), "tgz");
	assertEquals(archiveFormat("release.tgz"), "tgz");
});

Deno.test("a format that has no directory to read is not claimed", () => {
	assertEquals(archiveFormat("logs.gz"), null);
	assertEquals(archiveFormat("bundle.7z"), null);
	assertEquals(archiveFormat("zip"), null);
});
