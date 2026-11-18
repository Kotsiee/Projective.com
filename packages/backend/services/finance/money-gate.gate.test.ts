import { assert, assertEquals } from "@std/assert";

/**
 * The money switch's static gate (PRD-B3, LD2). Every `.rpc(…)` a finance service makes is one of:
 *
 * - a **read** — the database declares the function `STABLE` or `IMMUTABLE` in every definition
 *   (`supabase/migrations/`), so it cannot write; reads are never gated (a person still sees their
 *   real wallet with the switch off);
 * - **allowlisted** below, with the reason it is not a user-initiated money write;
 * - or a **write**, made from a function that passes the money switch (`refuseUnlessMoneyLive` /
 *   `moneyWritesLive`, `money-gate.ts`, or a helper of its own file listed in {@link GATED_HELPERS})
 *   before the call.
 *
 * A new finance write that calls its door without the switch fails here, as does a door called by a
 * name the scan cannot read (a variable) outside the allowlist. `money-gate.test.ts` proves the
 * behaviour: with the switch off, each known write answers 503 before any request.
 */

// #region Contract
/**
 * Door calls that are not user-initiated money writes, keyed `file#door` (a literal door name) or
 * `file#function` (a door named by a variable, keyed by the function that calls it).
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
	"fx-quotes.ts#quote_fx_conversion":
		"A rate lock: writes one finance.fx_quotes row and moves no money. Only a funding door consumes it, and every one of those is behind the switch.",
	"proposal-allowance.ts#get_proposal_allowance":
		"A read the database leaves VOLATILE (the drip reads the clock); its body writes nothing.",
	"proposal-allowance.ts#record_proposal_denial":
		"Telemetry (entitlement.denied) that moves no money; already behind isFinanceBackendLive with the rest of the allowance.",
	"stage-funding.ts#get_stage_funding_quote":
		"A read-only quote left at the default volatility; fund_stage and fund_with_conversion re-check it at the commit, behind the switch.",
	"ticket-funding.ts#get_ticket_funding_quote":
		"A read-only quote left at the default volatility; the ticket's funding doors re-check it at the commit, behind the switch.",
	"live-payments.ts#serviceRpc":
		"Service role: the doors only the signature-verified Stripe webhook and the FINANCE_CRON_SECRET crons reach. Not user-initiated; those entry points refuse while the switch is off (PaymentBackendService.liveSettings).",
	"live-payments.ts#claim_unsettled_card_payments":
		"Service role: the card-payment sweep cron's claim. Not user-initiated; the sweep refuses while the switch is off.",
	"live-payments.ts#fn_claim_stale_payouts":
		"Service role: the stale-payout sweep cron's claim. Not user-initiated; the sweep refuses while the switch is off.",
	"live-payments.ts#fn_claim_due_payout_schedules":
		"Service role: the payout-schedule cron's claim. Not user-initiated; the run refuses while the switch is off.",
	"live-payments.ts#claim_due_deposit_rules":
		"Service role: the recurring-deposit cron's claim. Not user-initiated; the run refuses while the switch is off.",
};

/** Helpers that pass the switch first, by file: a call to one counts as passing it. Each is checked. */
const GATED_HELPERS: Readonly<Record<string, readonly string[]>> = {
	"wallet-actions.ts": ["moneyGate", "contextFor"],
};

/** Doors that move money: the scan must classify each as a write, or the classifier is broken. */
const KNOWN_WRITES = [
	"transfer_funds",
	"distribute_vault",
	"fund_stage",
	"fund_with_conversion",
	"save_payout_schedule",
	"decide_spend_approval",
	"save_wallet_pot",
	"move_pot_funds",
	"pay_invoice",
	"resolve_dispute",
];

const GATE = /\b(?:refuseUnlessMoneyLive|moneyWritesLive)\s*[<(]/;
// #endregion

// #region Scan
/** Each function's volatility in every definition, from the consolidated migrations. */
function readOnlyDoors(sql: string): Set<string> {
	const volatility = new Map<string, string[]>();
	const create = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+[a-z_]+\.([a-z0-9_]+)\s*\(/gi;
	for (const match of sql.matchAll(create)) {
		const rest = sql.slice(match.index!, match.index! + 6_000);
		const body = rest.search(/\bAS\s+\$/i);
		const head = rest.slice(0, body < 0 ? 600 : body);
		const kind = /\bIMMUTABLE\b/i.test(head)
			? "IMMUTABLE"
			: /\bSTABLE\b/i.test(head)
			? "STABLE"
			: "VOLATILE";
		volatility.set(match[1], [...(volatility.get(match[1]) ?? []), kind]);
	}
	return new Set(
		[...volatility].filter(([, kinds]) => kinds.every((k) => k !== "VOLATILE")).map(([name]) =>
			name
		),
	);
}

/** A door call: its file, line, door (or the variable naming it), and the function making it. */
interface DoorCall {
	file: string;
	line: number;
	door: string;
	dynamic: boolean;
	fn: string;
	/** The enclosing function's text from its declaration up to the call. */
	before: string;
}

const DECLARATION = [
	/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
	/^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
	/^\t(?:static\s+)(?:async\s+)?([A-Za-z_$][\w$]*)\s*[<(]/,
];

/** The declaration enclosing offset `at` (a top-level function or const, or a static class method). */
function enclosing(lines: readonly string[], line: number): { name: string; start: number } {
	for (let i = line; i >= 0; i--) {
		for (const pattern of DECLARATION) {
			const match = pattern.exec(lines[i]);
			if (match) return { name: match[1], start: i };
		}
	}
	return { name: "(module)", start: 0 };
}

/** Every `.rpc(…)` in one source file. */
function doorCalls(file: string, source: string): DoorCall[] {
	const lines = source.split(/\r?\n/);
	const lineStarts: number[] = [];
	let offset = 0;
	for (const text of lines) {
		lineStarts.push(offset);
		offset += text.length + 1;
	}
	const text = lines.join("\n");
	const calls: DoorCall[] = [];
	for (const match of text.matchAll(/\.rpc\(\s*(?:"([A-Za-z0-9_]+)"|([A-Za-z_$][\w$]*))/g)) {
		let line = lineStarts.findIndex((start) => start > match.index!) - 1;
		if (line < 0) line = lines.length - 1;
		const { name, start } = enclosing(lines, line);
		calls.push({
			file,
			line: line + 1,
			door: match[1] ?? match[2],
			dynamic: !match[1],
			fn: name,
			before: text.slice(lineStarts[start], match.index!),
		});
	}
	return calls;
}

/** Whether `before` passes the switch: the gate itself, or a call to a gated helper of the file. */
function passesSwitch(before: string, helpers: readonly string[]): boolean {
	if (GATE.test(before)) return true;
	return helpers.some((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(before));
}

/** The calls that write without the switch, and the allowlist keys the scan used. */
function offenders(
	calls: readonly DoorCall[],
	readOnly: ReadonlySet<string>,
): { ungated: DoorCall[]; allowed: Set<string> } {
	const ungated: DoorCall[] = [];
	const allowed = new Set<string>();
	for (const call of calls) {
		if (!call.dynamic && readOnly.has(call.door)) continue;
		const key = `${call.file}#${call.dynamic ? call.fn : call.door}`;
		if (key in ALLOWLIST) {
			allowed.add(key);
			continue;
		}
		if (!passesSwitch(call.before, GATED_HELPERS[call.file] ?? [])) ungated.push(call);
	}
	return { ungated, allowed };
}

async function financeSources(): Promise<Map<string, string>> {
	const dir = new URL("./", import.meta.url);
	const out = new Map<string, string>();
	for await (const entry of Deno.readDir(dir)) {
		if (!entry.isFile || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
		out.set(entry.name, await Deno.readTextFile(new URL(entry.name, dir)));
	}
	return out;
}

async function migrations(): Promise<string> {
	const dir = new URL("../../../../supabase/migrations/", import.meta.url);
	const parts: string[] = [];
	for await (const entry of Deno.readDir(dir)) {
		if (entry.isFile && entry.name.endsWith(".sql")) {
			parts.push(await Deno.readTextFile(new URL(entry.name, dir)));
		}
	}
	return parts.join("\n");
}
// #endregion

// #region Gate
Deno.test("money gate: every finance door that can write is called through the money switch", async () => {
	const readOnly = readOnlyDoors(await migrations());
	const sources = await financeSources();
	const calls = [...sources].flatMap(([file, source]) => doorCalls(file, source));
	const { ungated, allowed } = offenders(calls, readOnly);
	assertEquals(
		ungated.map((c) => `${c.file}:${c.line} ${c.dynamic ? `<${c.door}>` : c.door} in ${c.fn}()`),
		[],
		"each of these writes without passing refuseUnlessMoneyLive / moneyWritesLive first (money-gate.ts)",
	);
	const stale = Object.keys(ALLOWLIST).filter((key) => !allowed.has(key));
	assertEquals(stale, [], "an allowlist entry matches no door call any more: remove it");
	const writes = calls.filter((c) => c.dynamic || !readOnly.has(c.door));
	assert(
		writes.length >= 25,
		`the scan found only ${writes.length} write calls: is it still reading the files?`,
	);
});

Deno.test("money gate: the classifier sees money doors as writes and reads as reads", async () => {
	const readOnly = readOnlyDoors(await migrations());
	for (const door of KNOWN_WRITES) assert(!readOnly.has(door), `${door} must classify as a write`);
	for (const door of ["list_ledger", "get_billing_settings", "get_dispute"]) {
		assert(readOnly.has(door), `${door} must classify as a read`);
	}
});

Deno.test("money gate: each gated helper passes the switch itself", async () => {
	const sources = await financeSources();
	for (const [file, helpers] of Object.entries(GATED_HELPERS)) {
		const lines = (sources.get(file) ?? "").split(/\r?\n/);
		for (const helper of helpers) {
			const start = lines.findIndex((l) =>
				new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${helper}\\b`).test(l)
			);
			assert(start >= 0, `${file}: ${helper} is not declared`);
			const end = lines.findIndex((l, i) => i > start && l === "}");
			const body = lines.slice(start + 1, end).join("\n");
			const others = helpers.filter((h) => h !== helper);
			assert(passesSwitch(body, others), `${file}: ${helper} does not pass the money switch`);
		}
	}
});

Deno.test("money gate: an ungated write is caught, a gated one and a read are not", () => {
	const source = [
		"export async function sneaky(accessToken: string) {",
		'\tawait getUserClient(accessToken).schema("finance").rpc("transfer_funds", {});',
		"}",
		"export async function guarded(actor: ReadActor) {",
		"\tconst refused = refuseUnlessMoneyLive(actor);",
		"\tif (refused) return refused;",
		'\tawait getUserClient(actor.accessToken).schema("finance").rpc("transfer_funds", {});',
		"}",
		"export async function reads(accessToken: string) {",
		'\tawait getUserClient(accessToken).schema("finance").rpc("list_ledger", {});',
		"}",
		"export class Service {",
		"\tstatic async door(name: string) {",
		"\t\treturn await db.rpc(name, {});",
		"\t}",
		"}",
	].join("\n");
	const { ungated } = offenders(doorCalls("synthetic.ts", source), new Set(["list_ledger"]));
	assertEquals(ungated.map((c) => [c.fn, c.door, c.dynamic]), [
		["sneaky", "transfer_funds", false],
		[
			"door",
			"name",
			true,
		],
	]);
});
// #endregion
