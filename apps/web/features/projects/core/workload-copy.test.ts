import { assertEquals } from "@std/assert";
import { globalCapReason, stageCapReason } from "@projective/types/projects";
import { claimCapacityLine, gaugeCopy, simulateWorkload } from "./workload-copy.ts";

const LOAD = { current: 2, cap: 5, ticketCount: 2, stages: [{ stageId: "s1", current: 1.5 }] };

Deno.test("the gauge states both figures and what is left", () => {
	const copy = gaugeCopy(LOAD);
	assertEquals([copy.level, copy.percent, copy.figure], ["normal", 40, "2 of 5"]);
	assertEquals(copy.note, "2 tickets held · 3 free");
	assertEquals(copy.label, "Workload: 2 of your cap of 5");
});

Deno.test("the gauge says near and at in words, not colour alone", () => {
	assertEquals(
		gaugeCopy({ current: 4.5, cap: 5, ticketCount: 4 }).note,
		"4 tickets held · 0.5 left, less than one standard ticket",
	);
	const at = gaugeCopy({ current: 5, cap: 5, ticketCount: 1 });
	assertEquals([at.level, at.percent], ["at", 100]);
	assertEquals(at.note, "1 ticket held · At your cap: submit current work before claiming more");
});

Deno.test("Claim says what the ticket adds while it fits", () => {
	const line = claimCapacityLine(LOAD, 1.5, "s1", null);
	assertEquals(line?.verdict.allowed, true);
	assertEquals(line?.text, "This ticket adds 1.5 · you'd be at 3.5 of 5");
});

Deno.test("Claim repeats the door's sentence when a cap would be passed", () => {
	const global = claimCapacityLine(LOAD, 3.5, "s1", null);
	assertEquals(global?.verdict.scope, "global");
	assertEquals(global?.text, globalCapReason(3.5, 5.5, 5));

	const stage = claimCapacityLine(LOAD, 1, "s1", 2);
	assertEquals(stage?.verdict.scope, "stage");
	assertEquals(stage?.text, stageCapReason(1, 2.5, 2));

	assertEquals(claimCapacityLine(LOAD, 1, "s2", 2)?.verdict.allowed, true, "another stage holds 0");
	assertEquals(claimCapacityLine(null, 1, "s1", 2), null, "no read, no line");
});

Deno.test("the dev axis substitutes the load on the real cap", () => {
	assertEquals(simulateWorkload("auto", LOAD), LOAD);
	assertEquals(simulateWorkload("at", LOAD)?.current, 5);
	assertEquals(simulateWorkload("near", LOAD)?.current, 4.5);
	assertEquals(simulateWorkload("normal", LOAD)?.current, 2);
	assertEquals(simulateWorkload("at", null)?.cap, 10);
});
