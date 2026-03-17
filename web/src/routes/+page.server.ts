import { listReports } from '$lib/server/reports.js';
import { getDataSummary } from '$lib/server/data.js';

export function load() {
	return {
		reports: listReports(),
		data: getDataSummary(),
	};
}
