import type { JSX } from "preact";
import { Stack, type StackProps } from "./Stack.tsx";

/** Column — a vertical Stack (`direction="column"`, the Stack default). */
export function Column(props: Omit<StackProps, "direction">): JSX.Element {
	return <Stack direction="column" {...props} />;
}
