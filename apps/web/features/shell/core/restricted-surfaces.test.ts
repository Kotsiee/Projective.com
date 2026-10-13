import { assert, assertEquals } from "@std/assert";
import { isRestrictedPath } from "./restricted-surfaces.ts";

Deno.test("isRestrictedPath — money, selling and workspace surfaces, at any depth", () => {
	for (
		const path of [
			"/wallet",
			"/wallet/payouts",
			"/businesses",
			"/businesses/create",
			"/basket",
			"/checkout/payment",
			"/catalogue/svc-1",
			"/services/new",
			"/products/new",
			"/teams/create",
			"/analytics",
			"/become-partner",
			"/settings/verification",
			"/settings/billing",
		]
	) assert(isRestrictedPath(path), path);
});

Deno.test("isRestrictedPath — a shared prefix is not a match, and personal surfaces stay", () => {
	for (
		const path of [
			"/walletish",
			"/home",
			"/projects",
			"/projects/prj-abc/board",
			"/explore",
			"/messages",
			"/calendar",
			"/files",
			"/settings/account",
		]
	) assertEquals(isRestrictedPath(path), false, path);
});
