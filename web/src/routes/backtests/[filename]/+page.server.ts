import { error } from '@sveltejs/kit';
import { getReportHtml } from '$lib/server/reports.js';

export function load({ params }) {
	const html = getReportHtml(params.filename);
	if (!html) throw error(404, 'Report not found');
	return { html, filename: params.filename };
}
