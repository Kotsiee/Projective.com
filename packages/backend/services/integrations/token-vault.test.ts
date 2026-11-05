/**
 * The token vault (Decision #343, ruling C4 (c)): the envelope round-trips, refuses another key's row,
 * fails a tag loudly, and never repeats a key or a nonce.
 */
import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import { SealedSecretSchema } from "@projective/types/integrations";
import { activeKeyId, assertVaultKeyAllowed, seal, unseal } from "./token-vault.ts";

const CONNECTION = "c0a8012e-0000-4000-8000-000000000001";
const KEY = "ab".repeat(32);
const OTHER_KEY = "cd".repeat(32);
const TOKENS = { access_token: "ya29.access", refresh_token: "1//refresh" };

const ENV: Record<string, string | undefined> = {
	USE_MOCKS: undefined,
	VITE_USE_MOCKS: undefined,
	INTEGRATIONS_BACKEND_LIVE: "true",
	SUPABASE_URL: "http://postgrest.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	ENCRYPTION_KEY: KEY,
};

/** Run `body` with the integrations gate on and a key configured, restoring the environment after. */
async function withVault(body: () => unknown, env: typeof ENV = {}) {
	const merged = { ...ENV, ...env };
	const saved = Object.keys(merged).map((name) => [name, Deno.env.get(name)] as const);
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	for (const [name, value] of Object.entries(merged)) apply(name, value);
	try {
		await body();
	} finally {
		for (const [name, value] of saved) apply(name, value);
	}
}

/** One bit flipped in the middle of a `\x…` value. */
function flipped(bytea: string): string {
	const at = Math.floor(bytea.length / 2);
	const nibble = (parseInt(bytea[at], 16) ^ 1).toString(16);
	return bytea.slice(0, at) + nibble + bytea.slice(at + 1);
}

Deno.test("a sealed row round-trips each token, and holds neither as plaintext", () =>
	withVault(async () => {
		const sealed = await seal(CONNECTION, TOKENS);
		SealedSecretSchema.parse(sealed);
		assertEquals(sealed.key_id, await activeKeyId());
		assertEquals(await unseal(CONNECTION, sealed, "access_token"), TOKENS.access_token);
		assertEquals(await unseal(CONNECTION, sealed, "refresh_token"), TOKENS.refresh_token);
		assertEquals(await unseal(CONNECTION, sealed, "api_secret"), null);
		assertEquals(sealed.api_secret_cipher, null);
		assert(!JSON.stringify(sealed).includes(TOKENS.access_token));
	}));

Deno.test("key_id is env: and the first 8 hex of sha256(key)", () =>
	withVault(async () => {
		const raw = Uint8Array.from({ length: 32 }, () => 0xab);
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
		const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
		assertEquals(await activeKeyId(), `env:${hex.slice(0, 8)}`);
	}));

Deno.test("a row whose key_id is not the current key's refuses, before any decryption", () =>
	withVault(async () => {
		const sealed = await seal(CONNECTION, TOKENS);
		await withVault(
			() =>
				assertRejects(
					() => unseal(CONNECTION, sealed, "access_token"),
					Error,
					"not the current key",
				),
			{ ENCRYPTION_KEY: OTHER_KEY },
		);
	}));

Deno.test("one flipped ciphertext byte fails the tag loudly", () =>
	withVault(async () => {
		const sealed = await seal(CONNECTION, TOKENS);
		await assertRejects(
			() =>
				unseal(
					CONNECTION,
					{ ...sealed, access_token_cipher: flipped(sealed.access_token_cipher!) },
					"access_token",
				),
			Error,
			"tag check",
		);
		await assertRejects(
			() =>
				unseal(CONNECTION, { ...sealed, wrapped_dek: flipped(sealed.wrapped_dek) }, "access_token"),
			Error,
			"tag check",
		);
	}));

Deno.test("a ciphertext moved to another connection or another column fails the tag", () =>
	withVault(async () => {
		const sealed = await seal(CONNECTION, TOKENS);
		const elsewhere = "c0a8012e-0000-4000-8000-000000000002";
		await assertRejects(() => unseal(elsewhere, sealed, "access_token"), Error, "tag check");
		const swapped = {
			...sealed,
			refresh_token_cipher: sealed.access_token_cipher,
			refresh_token_nonce: sealed.nonce,
		};
		await assertRejects(() => unseal(CONNECTION, swapped, "refresh_token"), Error, "tag check");
	}));

Deno.test("two seals of one plaintext share no DEK, nonce or ciphertext", () =>
	withVault(async () => {
		const first = await seal(CONNECTION, TOKENS);
		const second = await seal(CONNECTION, TOKENS);
		for (
			const column of [
				"wrapped_dek",
				"wrapped_dek_nonce",
				"access_token_cipher",
				"nonce",
				"refresh_token_cipher",
				"refresh_token_nonce",
			] as const
		) assertNotEquals(first[column], second[column], column);
		assertNotEquals(first.nonce, first.refresh_token_nonce);
	}));

Deno.test("with the gate off the vault refuses rather than encode", () =>
	withVault(async () => {
		await assertRejects(() => seal(CONNECTION, TOKENS), Error, "disabled");
		await assertRejects(
			() => unseal(CONNECTION, {} as Parameters<typeof unseal>[1], "access_token"),
			Error,
			"disabled",
		);
	}, { INTEGRATIONS_BACKEND_LIVE: "false" }));

Deno.test("the boot refuses a missing, placeholder or short key while the gate is on", () =>
	withVault(async () => {
		assertVaultKeyAllowed();
		for (const bad of [undefined, "XXXX-XXXX", "ab".repeat(16), "zz".repeat(32)]) {
			await withVault(
				() => void assertThrows(assertVaultKeyAllowed, Error, "Refusing to start"),
				{ ENCRYPTION_KEY: bad },
			);
		}
		await withVault(assertVaultKeyAllowed, {
			INTEGRATIONS_BACKEND_LIVE: "false",
			ENCRYPTION_KEY: undefined,
		});
	}));
