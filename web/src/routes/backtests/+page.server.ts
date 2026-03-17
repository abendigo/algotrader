import { listReports } from '$lib/server/reports.js';

export function load() {
	return { reports: listReports() };
}
