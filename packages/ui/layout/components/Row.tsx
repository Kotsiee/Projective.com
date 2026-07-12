import type { JSX } from "preact";
import { Stack, type StackProps } from "./Stack.tsx";

/** Row — a horizontal Stack (`direction="row"`). */
export function Row(props: Omit<StackProps, "direction">): JSX.Element {
	return <Stack direction="row" {...props} />;
}
