import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '../../../../data');

export interface DatasetInfo {
	granularity: string;
	instrument: string;
	days: number;
	dateRange: { from: string; to: string };
}

export function listDatasets(): DatasetInfo[] {
	if (!existsSync(DATA_DIR)) return [];

	const granularities = readdirSync(DATA_DIR).filter(g => {
		const p = join(DATA_DIR, g);
		try { return readdirSync(p).length > 0; } catch { return false; }
	});

	const datasets: DatasetInfo[] = [];

	for (const gran of granularities) {
		const granDir = join(DATA_DIR, gran);
		const entries = readdirSync(granDir);

		for (const entry of entries) {
			const instDir = join(granDir, entry);
			try {
				const files = readdirSync(instDir)
					.filter(f => f.endsWith('.json'))
					.sort();

				if (files.length > 0) {
					datasets.push({
						granularity: gran,
						instrument: entry,
						days: files.length,
						dateRange: {
							from: files[0].replace('.json', ''),
							to: files[files.length - 1].replace('.json', ''),
						},
					});
				}
			} catch {
				// Legacy single-file format — skip
			}
		}
	}

	return datasets;
}

export function getDataSummary(): {
	granularities: { name: string; instruments: number; days: number; dateRange: { from: string; to: string } }[];
} {
	const datasets = listDatasets();
	const byGran = new Map<string, DatasetInfo[]>();

	for (const d of datasets) {
		const list = byGran.get(d.granularity) ?? [];
		list.push(d);
		byGran.set(d.granularity, list);
	}

	const granularities = [...byGran.entries()].map(([name, items]) => {
		const allDates = items.flatMap(i => [i.dateRange.from, i.dateRange.to]).sort();
		return {
			name,
			instruments: items.length,
			days: Math.max(...items.map(i => i.days)),
			dateRange: {
				from: allDates[0],
				to: allDates[allDates.length - 1],
			},
		};
	});

	return { granularities };
}
