import { assert, assertEquals, assertFalse } from "@std/assert";
import type { EmbeddingsOverride } from "@projective/types/explore";
import { hasVoyageKey, readEmbeddingsOverride, resolveEmbeddingsGate } from "./embeddings-gate.ts";
import { embeddingsStatus, isEmbeddingsLive } from "./supabase.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(vars)) prior.set(key, Deno.env.get(key));
	try {
		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		fn();
	} finally {
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

function requestWith(cookie?: string): Request {
	return new Request("http://localhost/explore?q=logo", {
		headers: cookie ? { cookie } : {},
	});
}

const CONFIGURED: Record<string, string | undefined> = {
	USE_MOCKS: undefined,
	VITE_USE_MOCKS: undefined,
	SUPABASE_URL: "http://127.0.0.1:54321",
	SUPABASE_ANON_KEY: "anon-key",
	VOYAGE_API_KEY: "pa-test-key-not-real",
	EMBEDDINGS_ENABLED: "false",
	DENO_ENV: "development",
};

Deno.test("embeddings gate — the full env × cookie × dev/prod × key truth table", () => {
	const overrides: Array<EmbeddingsOverride | null> = [null, "on", "off"];
	let rows = 0;
	for (const envEnabled of [false, true]) {
		for (const override of overrides) {
			for (const development of [true, false]) {
				for (const keyPresent of [true, false]) {
					const status = resolveEmbeddingsGate({
						useMocks: false,
						supabaseConfigured: true,
						keyPresent,
						envEnabled,
						development,
						override,
					});
					const counted = development ? override : null;
					const setting = counted === null ? envEnabled : counted === "on";
					assertEquals(
						status.ranking,
						keyPresent && setting ? "semantic" : "heuristic",
						`env=${envEnabled} cookie=${override} dev=${development} key=${keyPresent}`,
					);
					assertEquals(status.override, counted, "an override outside development is not reported");
					rows++;
				}
			}
		}
	}
	assertEquals(rows, 24);
});

Deno.test("embeddings gate — USE_MOCKS or an unconfigured Supabase keeps it off whatever else says on", () => {
	const on = {
		keyPresent: true,
		envEnabled: true,
		development: true,
		override: "on" as const,
	};
	assertEquals(
		resolveEmbeddingsGate({ ...on, useMocks: true, supabaseConfigured: true }).ranking,
		"heuristic",
	);
	assertEquals(
		resolveEmbeddingsGate({ ...on, useMocks: false, supabaseConfigured: false }).ranking,
		"heuristic",
	);
	assertEquals(
		resolveEmbeddingsGate({ ...on, useMocks: false, supabaseConfigured: true }).ranking,
		"semantic",
	);
});

Deno.test("isEmbeddingsLive — follows EMBEDDINGS_ENABLED when no request is given", () => {
	withEnv({ ...CONFIGURED, EMBEDDINGS_ENABLED: undefined }, () => {
		assertFalse(isEmbeddingsLive(), "the default is off");
	});
	withEnv({ ...CONFIGURED, EMBEDDINGS_ENABLED: "true" }, () => {
		assert(isEmbeddingsLive());
	});
});

Deno.test("isEmbeddingsLive — the development cookie overrides the environment both ways", () => {
	withEnv({ ...CONFIGURED, EMBEDDINGS_ENABLED: "false" }, () => {
		assert(isEmbeddingsLive(requestWith("pj.a11y=x; pj.dev.embeddings=on")));
		assertFalse(isEmbeddingsLive(requestWith("pj.dev.embeddings=off")));
		assertFalse(isEmbeddingsLive(requestWith()), "no cookie follows the environment");
	});
	withEnv({ ...CONFIGURED, EMBEDDINGS_ENABLED: "true" }, () => {
		assertFalse(isEmbeddingsLive(requestWith("pj.dev.embeddings=off")));
		assert(isEmbeddingsLive(requestWith("pj.dev.embeddings=maybe")), "an unknown value is ignored");
	});
});

Deno.test("isEmbeddingsLive — production ignores the cookie completely", () => {
	withEnv({ ...CONFIGURED, DENO_ENV: "production", EMBEDDINGS_ENABLED: "false" }, () => {
		assertFalse(isEmbeddingsLive(requestWith("pj.dev.embeddings=on")));
		assertEquals(embeddingsStatus(requestWith("pj.dev.embeddings=on")).override, null);
	});
	withEnv({ ...CONFIGURED, DENO_ENV: "production", EMBEDDINGS_ENABLED: "true" }, () => {
		assert(isEmbeddingsLive(requestWith("pj.dev.embeddings=off")));
	});
});

Deno.test("isEmbeddingsLive — turning it on through the cookie still requires the key", () => {
	withEnv({ ...CONFIGURED, VOYAGE_API_KEY: undefined }, () => {
		assertFalse(isEmbeddingsLive(requestWith("pj.dev.embeddings=on")));
		assertFalse(embeddingsStatus().keyPresent);
	});
	withEnv({ ...CONFIGURED, VOYAGE_API_KEY: "XXXX-XXXX" }, () => {
		assertFalse(isEmbeddingsLive(requestWith("pj.dev.embeddings=on")), "the placeholder is no key");
	});
	withEnv({ ...CONFIGURED, USE_MOCKS: "true" }, () => {
		assertFalse(isEmbeddingsLive(requestWith("pj.dev.embeddings=on")));
	});
});

Deno.test("readEmbeddingsOverride — reads only its own cookie and only its own vocabulary", () => {
	assertEquals(readEmbeddingsOverride(null), null);
	assertEquals(readEmbeddingsOverride("pj.dev.embeddings=on"), "on");
	assertEquals(readEmbeddingsOverride("a=1; pj.dev.embeddings=off; b=2"), "off");
	assertEquals(readEmbeddingsOverride("pj.dev.embeddings=%6Fn"), "on");
	assertEquals(readEmbeddingsOverride("pj.dev.embeddings=ON"), null);
	assertEquals(readEmbeddingsOverride("pj.dev.embeddingsx=on"), null);
	assertEquals(
		readEmbeddingsOverride("pj.dev.embeddings=%E0%A4%A"),
		null,
		"a malformed escape is ignored",
	);
});

Deno.test("hasVoyageKey — blank and the placeholder are absent", () => {
	assertFalse(hasVoyageKey(undefined));
	assertFalse(hasVoyageKey("   "));
	assertFalse(hasVoyageKey("XXXX-XXXX"));
	assert(hasVoyageKey("pa-abc123"));
});
