import { useEffect } from "preact/hooks";
import { recordPress } from "../core/press-point.ts";

/** Record every pointer press on the page while the caller is mounted (see `core/press-point.ts`). */
export function usePressTracking(): void {
	useEffect(() => {
		const onPress = (event: PointerEvent) => {
			recordPress({ x: event.clientX, y: event.clientY, at: event.timeStamp });
		};
		document.addEventListener("pointerdown", onPress, true);
		return () => document.removeEventListener("pointerdown", onPress, true);
	}, []);
}
