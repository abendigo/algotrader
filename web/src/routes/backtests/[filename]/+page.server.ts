import { error } from '@sveltejs/kit';
import { getReportHtml } from '$lib/server/reports.js';

export function load({ params, locals }) {
	const userId = locals.user?.id ?? '';
	const html = getReportHtml(userId, params.filename);
	if (!html) throw error(404, 'Report not found');
	return { html, filename: params.filename };
}
