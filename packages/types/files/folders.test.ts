import { assertEquals } from "@std/assert";
import { AssetFolderSchema, driveAddressOf, FolderColor, isMountPath } from "./folders.ts";
import { SetFolderColorSchema } from "./upload.ts";

const CONNECTION = "c0a8012e-0000-4000-8000-000000000001";

Deno.test("driveAddressOf reads a connection and its opaque folder ids", () => {
	assertEquals(driveAddressOf(["drives", CONNECTION]), { connectionId: CONNECTION, folderIds: [] });
	assertEquals(driveAddressOf(["drives", CONNECTION, "F1", "F2"]), {
		connectionId: CONNECTION,
		folderIds: ["F1", "F2"],
	});
});

Deno.test("driveAddressOf leaves a library folder called drives alone", () => {
	assertEquals(driveAddressOf(["drives"]), null);
	assertEquals(driveAddressOf(["drives", "Client work"]), null);
	assertEquals(driveAddressOf([CONNECTION]), null);
	assertEquals(driveAddressOf(undefined), null);
});

Deno.test("a folder colour is one lower-case hex value, as the database's check holds it", () => {
	assertEquals(FolderColor.safeParse("#3b82f6").success, true);
	for (const bad of ["#3B82F6", "#fff", "3b82f6", "blue", "#3b82f6; x"]) {
		assertEquals(FolderColor.safeParse(bad).success, false);
	}
});

Deno.test("a colour is set or cleared, and a folder with none reads as null", () => {
	assertEquals(SetFolderColorSchema.safeParse({ folderId: "f", color: null }).success, true);
	assertEquals(SetFolderColorSchema.safeParse({ folderId: "f", color: "#123456" }).success, true);
	assertEquals(SetFolderColorSchema.safeParse({ folderId: "f" }).success, false);
	assertEquals(AssetFolderSchema.shape.color.parse(undefined), null);
});

Deno.test("isMountPath recognises a mounted engagement only by its leading segment", () => {
	assertEquals(isMountPath(["mnt-prj-abc", "stage"]), true);
	assertEquals(isMountPath(["folder", "mnt-prj-abc"]), false);
	assertEquals(isMountPath([]), false);
});
