import { assert, assertEquals } from "@std/assert";
import type { IsoDate } from "@projective/types/scheduling";
import type { ReadActor } from "../read-actor.ts";
import { addBlackout, removeBlackout } from "./live-schedule-settings.ts";
import { listPresets } from "./live-presets.ts";
import { fakePresetDoors, stubSchedulingClient, type StubStore } from "./scheduling-stub-client.ts";

/**
 * live-schedule-settings_test — time off is whole local days in the schedule's zone (across a BST
 * date), a stranger's or a missing blackout is a 404, a backwards range is refused before any write,
 * and the presets read carries the schedule.
 */

// #region Fixtures
const OWNER: ReadActor & { accessToken: string } = {
	userId: "u-owner",
	contextId: "",
	contextType: "personal",
	accessToken: "token",
};
const SCHEDULE = "5c4d7a10-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-06-01T10:00:00Z");

function stack(withSchedule = true) {
	const store: StubStore = {
		schedules: withSchedule
			? [{
				id: SCHEDULE,
				owner_type: "user",
				owner_id: OWNER.userId,
				timezone: "Europe/London",
				is_published: false,
			}]
			: [],
		blackout_dates: [],
		availability_presets: [],
	};
	const stub = stubSchedulingClient(store, fakePresetDoors());
	return { store, ...stub, deps: { db: stub.client, service: stub.client, now: NOW } };
}

const DAYS = {
	startsOn: "2026-07-01" as IsoDate,
	endsOn: "2026-07-02" as IsoDate,
	labelIsPublic: false,
};
// #endregion

Deno.test("a blackout runs from local midnight to the midnight after its last day", async () => {
	const { store, deps } = stack();
	const res = await addBlackout({ ...DAYS, label: "Holiday" }, OWNER, deps);
	assert(res.ok && res.data);
	assertEquals(store.blackout_dates[0].starts_at, "2026-06-30T23:00:00.000Z");
	assertEquals(store.blackout_dates[0].ends_at, "2026-07-02T23:00:00.000Z");
	assertEquals(res.data.blackouts.map((b) => b.label), ["Holiday"]);
});

Deno.test("a blackout's label stays private unless the owner opts in, and reads back as stored", async () => {
	const { store, deps } = stack();
	await addBlackout({ ...DAYS, label: "Surgery" }, OWNER, deps);
	const shared = await addBlackout(
		{
			startsOn: "2026-08-03" as IsoDate,
			endsOn: "2026-08-07" as IsoDate,
			label: "Holiday",
			labelIsPublic: true,
		},
		OWNER,
		deps,
	);
	assert(shared.ok && shared.data);
	assertEquals(store.blackout_dates.map((b) => b.label_is_public), [false, true]);
	assertEquals(shared.data.blackouts.map((b) => [b.label, b.labelIsPublic]), [
		["Surgery", false],
		["Holiday", true],
	]);
});

Deno.test("a backwards range and a schedule never saved are refused before any write", async () => {
	const backwards = stack();
	const refused = await addBlackout(
		{ startsOn: DAYS.endsOn, endsOn: DAYS.startsOn, label: "Off", labelIsPublic: false },
		OWNER,
		backwards.deps,
	);
	assertEquals(refused.status, 422);
	assertEquals(backwards.store.blackout_dates.length, 0);

	const none = stack(false);
	const noSchedule = await addBlackout({ ...DAYS, label: "Off" }, OWNER, none.deps);
	assertEquals(noSchedule.status, 422);
	assertEquals(none.store.blackout_dates.length, 0);
});

Deno.test("removing a blackout takes only the owner's own row", async () => {
	const { store, deps } = stack();
	store.blackout_dates.push({
		id: "b-other",
		schedule_id: "someone-else",
		starts_at: "2026-07-01T00:00:00Z",
		ends_at: "2026-07-02T00:00:00Z",
		label: "Theirs",
	});
	const added = await addBlackout({ ...DAYS, label: "Mine" }, OWNER, deps);
	assert(added.ok && added.data);
	const mine = added.data.blackouts[0].id;

	assertEquals((await removeBlackout("b-other", OWNER, deps)).status, 404);
	const removed = await removeBlackout(mine, OWNER, deps);
	assert(removed.ok && removed.data);
	assertEquals(removed.data.blackouts, []);
	assertEquals(store.blackout_dates.map((b) => b.id), ["b-other"]);
});

Deno.test("the presets read carries the schedule's settings", async () => {
	const { deps } = stack();
	await addBlackout({ ...DAYS, label: "Holiday" }, OWNER, deps);
	const res = await listPresets(OWNER, deps);
	assert(res.ok && res.data?.schedule);
	assertEquals(res.data.schedule.timezone, "Europe/London");
	assertEquals(res.data.schedule.blackouts.length, 1);
});
