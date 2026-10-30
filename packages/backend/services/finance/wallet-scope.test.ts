import { assertEquals } from "@std/assert";
import { resolveTarget, type WalletAccount } from "./wallet-scope.ts";

const TEAM_ID = "0b5e3a52-3d0c-4c2e-9f61-2a7c1d9e8f00";
const FOREIGN_ID = "7c2d9e8f-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function account(scope: WalletAccount["scope"], id = ""): WalletAccount {
	return {
		scope,
		id,
		key: scope === "personal" ? "personal" : `${scope}:${id}`,
		owner: {} as WalletAccount["owner"],
		rows: [],
		role: null,
		capabilities: ["view"],
	};
}

const PERSONAL = account("personal");
const TEAM = account("team", TEAM_ID);
const ACCOUNTS = [PERSONAL, TEAM];

Deno.test("a wallet the viewer can open resolves to itself, its id read case-blind", () => {
	const r = resolveTarget(ACCOUNTS, `team:${TEAM_ID.toUpperCase()}`);
	assertEquals([r.target, r.requested, r.resolved], [TEAM, `team:${TEAM_ID}`, `team:${TEAM_ID}`]);
});

Deno.test("a wallet the viewer cannot open falls back to personal, and the read says so", () => {
	const r = resolveTarget(ACCOUNTS, `business:${FOREIGN_ID}`);
	assertEquals([r.target, r.requested, r.resolved], [
		PERSONAL,
		`business:${FOREIGN_ID}`,
		"personal",
	]);
});

Deno.test("a param that names no wallet is a mismatch too; personal and the rollup are themselves", () => {
	const garbled = resolveTarget(ACCOUNTS, "wallet");
	assertEquals([garbled.target, garbled.requested, garbled.resolved], [
		PERSONAL,
		"wallet",
		"personal",
	]);
	const personal = resolveTarget(ACCOUNTS, "personal");
	assertEquals([personal.requested, personal.resolved], ["personal", "personal"]);
	const all = resolveTarget(ACCOUNTS, "aggregate");
	assertEquals([all.target, all.requested, all.resolved], ["aggregate", "aggregate", "aggregate"]);
});

Deno.test("with no personal wallet to fall back to there is no target", () => {
	assertEquals(resolveTarget([TEAM], `business:${FOREIGN_ID}`).target, null);
});
