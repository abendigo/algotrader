import { listReports } from '$lib/server/reports.js';

export function load({ locals }) {
	const userId = locals.user?.id ?? '';
	return { reports: listReports(userId) };
}
