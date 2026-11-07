/**
 * page-engines — whether this page may run the model decoders. They need the `inspector` CSP profile
 * (`'wasm-unsafe-eval'`, `blob:` connect), which `/inspect/*` and `/files/*` send and every other page
 * does not. The page's policy is the truth, so this asks it rather than taking a prop that could
 * disagree with the header: compiling the smallest valid module throws under a policy without wasm.
 */

const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

let allowed: boolean | null = null;

/** Whether this page's policy admits WebAssembly, and with it the rest of the inspector profile. */
export function pageAllowsEngines(): boolean {
	if (allowed === null) {
		try {
			new WebAssembly.Module(EMPTY_MODULE);
			allowed = true;
		} catch {
			allowed = false;
		}
	}
	return allowed;
}
