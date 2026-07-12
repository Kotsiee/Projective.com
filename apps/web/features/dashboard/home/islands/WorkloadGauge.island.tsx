import { useSignal } from "@preact/signals";

/**
 * Example island — proves the features/ island-discovery wiring in vite.config.ts
 * (`discoverFeatureIslands` + `islandSpecifiers`). Islands are "dumb": no Supabase/DB access; all
 * data arrives via props (SYSTEM_ARCHITECTURE §2 / §State Hydration). Replace with the real
 * Workload-Capacity gauge (PRODUCT_SPEC §Resource Allocation, `projects.get_workload_capacity`).
 */
export interface WorkloadGaugeProps {
	/** Initial summed Workload Intensity (Wᵢ), hydrated from the server. */
	initial?: number;
}

export default function WorkloadGauge({ initial = 0 }: WorkloadGaugeProps) {
	const wi = useSignal(initial);
	return (
		<button
			type="button"
			class="workload-gauge"
			onClick={() => (wi.value = Math.round((wi.value + 0.5) * 10) / 10)}
		>
			Wᵢ: {wi.value.toFixed(1)}
		</button>
	);
}
