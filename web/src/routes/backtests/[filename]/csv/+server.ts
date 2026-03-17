import { error } from '@sveltejs/kit';
import { getReportCsv } from '$lib/server/reports.js';

export function GET({ params }) {
	const csv = getReportCsv(params.filename);
	if (!csv) throw error(404, 'CSV not found');

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv',
			'Content-Disposition': `attachment; filename="${params.filename}.csv"`,
		},
	});
}
