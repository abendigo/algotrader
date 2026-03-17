import { json } from '@sveltejs/kit';
import { listReports } from '$lib/server/reports.js';

export function GET() {
	return json(listReports());
}
