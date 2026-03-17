import { json } from '@sveltejs/kit';
import { getDataSummary } from '$lib/server/data.js';

export function GET() {
	return json(getDataSummary());
}
