import { assertEquals, assertRejects } from "@std/assert";
import {
	mintPendingVerification,
	PENDING_VERIFICATION_TTL_SECONDS,
	pendingVerificationKey,
	readPendingVerification,
} from "./pending-verification.ts";

const USER = "6f1c2a7e-3b4d-4c5e-8f90-a1b2c3d4e5f6";
const OTHER = "0a0b0c0d-1e1f-4a2b-8c3d-4e5f60718293";
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

Deno.test("a minted token reads back as the user id it names", async () => {
	const key = await pendingVerificationKey("root-secret-a");
	const token = await mintPendingVerification(USER, key, NOW);
	assertEquals(await readPendingVerification(token, key, NOW + 1_000), USER);
});

Deno.test("a token signed under another root secret is refused", async () => {
	const token = await mintPendingVerification(
		USER,
		await pendingVerificationKey("root-secret-a"),
		NOW,
	);
	assertEquals(
		await readPendingVerification(token, await pendingVerificationKey("root-secret-b"), NOW),
		null,
	);
});

Deno.test("a token whose user id was swapped keeps no valid signature", async () => {
	const key = await pendingVerificationKey("root-secret-a");
	const token = await mintPendingVerification(USER, key, NOW);
	assertEquals(await readPendingVerification(token.replace(USER, OTHER), key, NOW), null);
});

Deno.test("a token is refused once its lifetime has passed", async () => {
	const key = await pendingVerificationKey("root-secret-a");
	const token = await mintPendingVerification(USER, key, NOW);
	const expiry = NOW + PENDING_VERIFICATION_TTL_SECONDS * 1000;
	assertEquals(await readPendingVerification(token, key, expiry - 1_000), USER);
	assertEquals(await readPendingVerification(token, key, expiry), null);
});

Deno.test("absent and malformed tokens read as null", async () => {
	const key = await pendingVerificationKey("root-secret-a");
	for (
		const token of [undefined, null, "", "v1", `v1.${USER}.9999999999.***`, `v2.${USER}.1.abc`]
	) {
		assertEquals(await readPendingVerification(token, key, NOW), null);
	}
});

Deno.test("minting refuses anything but a user id", async () => {
	const key = await pendingVerificationKey("root-secret-a");
	await assertRejects(() => mintPendingVerification("ada@example.com", key, NOW), RangeError);
});
