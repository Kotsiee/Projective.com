import { assert, assertEquals } from "@std/assert";
import { actionTarget } from "./wallet-actions.ts";
import type { WalletAccount, WalletContext } from "./wallet-scope.ts";

const FOREIGN = "business:7c2d9e8f-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

/** The viewer's own wallet: what a foreign `w` used to fall back to, with money in it to move. */
const PERSONAL: WalletAccount = {
	scope: "personal",
	id: "",
	key: "personal",
	owner: {} as WalletAccount["owner"],
	rows: [{
		id: "w-own",
		owner_type: "user",
		owner_id: "u-1",
		currency: "USD",
		balance_cents: 50_000,
		approval_threshold_cents: null,
	}],
	role: null,
	capabilities: [
		"view",
		"add_funds",
		"spend",
		"distribute",
		"withdraw",
		"manage_members",
		"manage_billing",
	],
};

function contextOf(
	requested: string,
	resolved: string,
	target: WalletContext["target"],
): WalletContext {
	return { requested, resolved, target, accounts: [PERSONAL] } as unknown as WalletContext;
}

Deno.test("an action naming a wallet the viewer cannot open is refused before any door (Audit R5)", () => {
	// The read fell back to the personal wallet; the action must not run there.
	const out = actionTarget(contextOf(FOREIGN, "personal", PERSONAL));
	assert(!("account" in out), "no account comes back, so no door is called and nothing moves");
	assertEquals([out.ok, out.status, out.message], [
		false,
		403,
		"That wallet isn't available to you.",
	]);
});

Deno.test("an action on the wallet it names runs there; the rollup stays read-only", () => {
	const own = actionTarget(contextOf("personal", "personal", PERSONAL));
	assert("account" in own);
	assertEquals(own.account, PERSONAL);
	const all = actionTarget(contextOf("aggregate", "aggregate", "aggregate"));
	assert(!("account" in all));
	assertEquals(all.status, 422);
});
