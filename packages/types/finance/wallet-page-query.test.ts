import { assertEquals } from "@std/assert";
import { parseWalletPageQuery, walletPageSearch } from "./wallet.ts";

const TEAM = "team:0b5e3a52-3d0c-4c2e-9f61-2a7c1d9e8f00";

const parse = (qs: string) => parseWalletPageQuery(new URLSearchParams(qs));

Deno.test("a canonical address parses as itself and is not corrected", () => {
	const qs =
		`w=${TEAM}&flow=3m&display=EUR&tz=Europe%2FLondon&do=top_up&back=%2Fcheckout&q=acme&dir=in` +
		"&kind=escrow_release,topup";
	const { value, corrected } = parse(qs);
	assertEquals(corrected, false);
	assertEquals(value, {
		w: TEAM,
		flow: "3m",
		display: "EUR",
		tz: "Europe/London",
		do: "top_up",
		back: "/checkout",
		q: "acme",
		dir: "in",
		kind: ["escrow_release", "topup"],
	});
	assertEquals(
		new URLSearchParams(walletPageSearch(value)).toString(),
		new URLSearchParams(qs).toString(),
	);
});

Deno.test("an empty address is every default, uncorrected", () => {
	assertEquals(parse(""), {
		value: {
			w: null,
			flow: null,
			display: null,
			tz: null,
			do: null,
			back: null,
			q: null,
			dir: null,
			kind: [],
		},
		corrected: false,
	});
});

Deno.test("normalised spellings are kept but the address is corrected", () => {
	const upper = parse(`w=${TEAM.toUpperCase().replace("TEAM", "team")}`);
	assertEquals([upper.value.w, upper.corrected], [TEAM, true]);
	const legacy = parse("flow=quarter");
	assertEquals([legacy.value.flow, legacy.corrected], ["3m", true]);
	const lowerCurrency = parse("display=eur");
	assertEquals([lowerCurrency.value.display, lowerCurrency.corrected], ["EUR", true]);
	const kinds = parse("kind=topup,other,escrow_release,topup");
	assertEquals([kinds.value.kind, kinds.corrected], [["escrow_release", "topup"], true]);
	const q = parse("q=%20%20acme%20");
	assertEquals([q.value.q, q.corrected], ["acme", true]);
});

Deno.test("unknown or unsafe values are dropped and the address is corrected", () => {
	for (
		const qs of [
			"w=team:not-a-uuid",
			"w=wallet",
			"flow=fortnight",
			"display=XYZ",
			"tz=Mars%2FOlympus",
			"do=drain_everything",
			"do=request_spend",
			"back=https%3A%2F%2Fevil.example",
			"back=%2F%2Fevil.example",
			"dir=all",
			"dir=sideways",
			"q=",
			"kind=",
		]
	) {
		const { value, corrected } = parse(qs);
		assertEquals(corrected, true, qs);
		assertEquals(walletPageSearch(value), "", qs);
	}
});

Deno.test("the canonical search keeps params the schema does not name", () => {
	const base = new URLSearchParams("notice=wallet-unavailable&do=nope&w=personal");
	const { value } = parseWalletPageQuery(base);
	assertEquals(walletPageSearch(value, base), "w=personal&notice=wallet-unavailable");
});
