import { readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const DATA_ROOT = join(import.meta.dirname, '../../../../data/brokers');

export interface DatasetInfo {
	broker: string;
	granularity: string;
	instrument: string;
	days: number;
	dateRange: { from: string; to: string };
}

export function listDatasets(): DatasetInfo[] {
	if (!existsSync(DATA_ROOT)) return [];

	const datasets: DatasetInfo[] = [];

	// Discover brokers (directories that contain granularity subdirs)
	const entries = readdirSync(DATA_ROOT);

	for (const brokerOrGran of entries) {
		const full = join(DATA_ROOT, brokerOrGran);
		if (!statSync(full).isDirectory()) continue;

		// Check if this is a broker dir (contains granularity subdirs like M1, S5)
		const subEntries = readdirSync(full);
		const hasGranularities = subEntries.some(s => /^[SMHDW]\d*$/.test(s));

		if (hasGranularities) {
			// Broker directory: data/{broker}/{gran}/{instrument}/
			for (const gran of subEntries) {
				if (!/^[SMHDW]\d*$/.test(gran)) continue;
				const granDir = join(full, gran);
				if (!statSync(granDir).isDirectory()) continue;
				scanGranularity(datasets, brokerOrGran, gran, granDir);
			}
		} else if (/^[SMHDW]\d*$/.test(brokerOrGran)) {
			// Legacy: data/{gran}/{instrument}/ (no broker prefix)
			scanGranularity(datasets, 'legacy', brokerOrGran, full);
		}
	}

	return datasets;
}

function scanGranularity(
	datasets: DatasetInfo[],
	broker: string,
	granularity: string,
	granDir: string,
): void {
	for (const entry of readdirSync(granDir)) {
		const instDir = join(granDir, entry);
		try {
			if (!statSync(instDir).isDirectory()) continue;
			const files = readdirSync(instDir)
				.filter(f => f.endsWith('.json'))
				.sort();

			if (files.length > 0) {
				datasets.push({
					broker,
					granularity,
					instrument: entry,
					days: files.length,
					dateRange: {
						from: files[0].replace('.json', ''),
						to: files[files.length - 1].replace('.json', ''),
					},
				});
			}
		} catch {
			// skip non-directories
		}
	}
}

export function getDataSummary(): {
	brokers: {
		name: string;
		granularities: { name: string; instruments: number; days: number; dateRange: { from: string; to: string } }[];
	}[];
} {
	const datasets = listDatasets();
	const byBroker = new Map<string, DatasetInfo[]>();

	for (const d of datasets) {
		const list = byBroker.get(d.broker) ?? [];
		list.push(d);
		byBroker.set(d.broker, list);
	}

	const brokers = [...byBroker.entries()].map(([name, items]) => {
		const byGran = new Map<string, DatasetInfo[]>();
		for (const d of items) {
			const list = byGran.get(d.granularity) ?? [];
			list.push(d);
			byGran.set(d.granularity, list);
		}

		const granularities = [...byGran.entries()].map(([gName, gItems]) => {
			const allDates = gItems.flatMap(i => [i.dateRange.from, i.dateRange.to]).sort();
			return {
				name: gName,
				instruments: gItems.length,
				days: Math.max(...gItems.map(i => i.days)),
				dateRange: {
					from: allDates[0],
					to: allDates[allDates.length - 1],
				},
			};
		});

		return { name, granularities };
	});

	return { brokers };
}
