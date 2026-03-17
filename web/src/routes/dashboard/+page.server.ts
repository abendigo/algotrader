import { getDataSummary } from '$lib/server/data.js';

export function load() {
	return {
		data: getDataSummary(),
	};
}
