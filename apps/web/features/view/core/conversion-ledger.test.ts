import { assertEquals } from "@std/assert";
import type { ProjectStage } from "@projective/types/explore";
import {
	callLedger,
	flatLedger,
	type LedgerPrice,
	seatLedger,
	sessionLedger,
	stageLedger,
} from "./conversion-ledger.ts";

function stage(index: number, min: number, max = min): ProjectStage {
	return {
		id: `stg-${index}`,
		index,
		name: `Stage ${index}`,
		description: "",
		status: "upcoming",
		seatKind: "seats",
		openSeats: 1,
		seatsTotal: 1,
		seatsFilled: 0,
		roles: [],
		price: { min, max, label: "" },
		skills: [],
	};
}

const GBP_60: LedgerPrice = {
	amount: { minor: 6000, currency: "GBP" },
	fallback: "£60",
	unit: "session",
	isFloor: false,
};

Deno.test("stageLedger sums the funded stages' floors in the listing's currency", () => {
	const ledger = stageLedger([stage(1, 400), stage(2, 600)], "GBP");
	assertEquals(ledger.lines.map((l) => l.amount?.minor), [40000, 60000]);
	assertEquals(ledger.total, {
		label: "Due now · 2 stages",
		amount: { minor: 100000, currency: "GBP" },
		isFloor: false,
	});
	assertEquals(ledger.note, null);
});

Deno.test("stageLedger scales by the currency's own exponent, never a fixed ×100", () => {
	assertEquals(stageLedger([stage(1, 5000)], "JPY").total?.amount, {
		minor: 5000,
		currency: "JPY",
	});
});

Deno.test("a ranged stage makes the total a floor and says why", () => {
	const ledger = stageLedger([stage(1, 400, 800)], "GBP");
	assertEquals(ledger.total?.isFloor, true);
	assertEquals(ledger.total?.label, "Due now");
	assertEquals(typeof ledger.note, "string");
});

Deno.test("nothing funded states no total", () => {
	assertEquals(stageLedger([], "GBP").total, null);
});

Deno.test("flatLedger totals at the headline, or defers to the provider without a figure", () => {
	assertEquals(flatLedger(GBP_60, "One deliverable").total?.amount.minor, 6000);
	const quoted = flatLedger(
		{ amount: null, fallback: "Contact us", isFloor: false },
		"One deliverable",
	);
	assertEquals(quoted.total, null);
	assertEquals(quoted.lines[0].text, "Contact us");
});

Deno.test("a single session totals at its price; an unpicked one says so", () => {
	const ledger = sessionLedger(GBP_60, [], 1);
	assertEquals(ledger.lines[0].text, "No time picked yet");
	assertEquals(ledger.total?.amount.minor, 6000);
});

Deno.test("a block quotes per session and leaves its total to checkout", () => {
	const ledger = sessionLedger(GBP_60, ["Tue 14 Nov · 10:00–11:00"], 4);
	assertEquals(ledger.total, null);
	assertEquals(ledger.lines.map((l) => l.key), ["pick-0", "later", "rate"]);
	assertEquals(ledger.lines[1].label, "3 more sessions");
});

Deno.test("callLedger totals only a paid call with a set fee", () => {
	assertEquals(callLedger("courtesy", 20, null, null).total, null);
	assertEquals(callLedger("paid", 45, null, null).total, null);
	assertEquals(
		callLedger("paid", 45, "Tue · 10:00", { minor: 5000, currency: "GBP" }).total?.amount.minor,
		5000,
	);
});

Deno.test("seatLedger multiplies a per-seat price by the seats", () => {
	const ledger = seatLedger({ ...GBP_60, unit: "seat" }, 3, "4 sittings from Tue 14 Nov");
	assertEquals(ledger.total?.amount.minor, 18000);
	assertEquals(ledger.lines[0].key, "sittings");
});
