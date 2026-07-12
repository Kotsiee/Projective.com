import type { ComponentChildren } from "preact";
import { DesignSystemProvider } from "@projective/ui/system";

/**
 * Root theming mount (island). Hydrates on the client and — via `DesignSystemProvider root` — binds
 * the shared design-system config to `<html>`: Material You color tokens, the radius/shadow scale
 * knobs, and the accessibility `data-*` attributes stay in sync with the global store. First paint is
 * already correctly themed by the SSR `<style id="ds-tokens">` injected in _app.tsx, so there is no
 * flash; this island takes over for any runtime change (mode/seed/contrast/…).
 */
export default function DesignSystemRoot({ children }: { children?: ComponentChildren }) {
	return <DesignSystemProvider root>{children}</DesignSystemProvider>;
}
