import type { JSX } from "preact";
import "../styles/inspector.css";
import {
	InspectorUnavailable as UnavailableView,
	type InspectorUnavailableProps,
} from "../components/InspectorUnavailable.tsx";

/** The standalone not-available page; an island only so the inspector stylesheet ships with it. */
export default function InspectorUnavailable(props: InspectorUnavailableProps): JSX.Element {
	return <UnavailableView signedIn={props.signedIn} />;
}
