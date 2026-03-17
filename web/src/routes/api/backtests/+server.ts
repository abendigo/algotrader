import { json } from '@sveltejs/kit';
import { listReports } from '$lib/server/reports.js';
import { getUserBacktests, clearFinishedBacktests } from '$lib/server/processes.js';

export function GET({ locals, url }) {
	const userId = locals.user?.id ?? '';
	const type = url.searchParams.get('type');

	if (type === 'running') {
		const bts = getUserBacktests(userId).map((b) => ({
			id: b.id,
			strategy: b.strategy,
			granularity: b.granularity,
			startedAt: b.startedAt,
			status: b.status,
			lastOutput: b.output.length > 0 ? b.output[b.output.length - 1] : "",
		}));
		return json(bts);
	}

	if (type === 'clear') {
		clearFinishedBacktests(userId);
		return json({ success: true });
	}

	return json(listReports(userId));
}
