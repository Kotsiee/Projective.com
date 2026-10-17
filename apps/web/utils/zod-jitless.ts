/**
 * zod-jitless.ts — switch Zod 4 into `jitless` mode for the client bundle.
 *
 * Zod 4 compiles a fast-path parser for every `z.object` with `new Function`, and probes for eval
 * support (`util.allowsEval`) the moment the first object schema is CONSTRUCTED — i.e. while an
 * island's schema module is still evaluating. The app CSP (`utils/csp.ts`) has no `'unsafe-eval'`,
 * so that probe raised a `securitypolicyviolation` (script-src ← eval) on every hydrated page. Zod
 * swallows the throw and falls back, so nothing broke — but every page reported a violation, which
 * would flood any future `report-uri`.
 *
 * `jitless: true` skips both the probe and the compiler (the interpreted parser is what already ran
 * under the CSP, so behaviour is unchanged). The flag lives on `globalThis.__zod_globalConfig`, so it
 * reaches every copy of Zod in the bundle.
 *
 * ORDER MATTERS: this must evaluate before any module that builds a schema. It is the FIRST import
 * of `client.ts`, and Fresh's boot script imports the client entry before any island, so it runs
 * ahead of every island's schema modules. The server keeps the JIT (no CSP applies to Deno).
 */
import { config } from "zod";

config({ jitless: true });
