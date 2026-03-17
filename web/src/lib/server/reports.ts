import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const REPORTS_DIR = join(import.meta.dirname, '../../../../reports');

export interface ReportSummary {
	filename: string;
	strategy: string;
	granularity: string;
	timestamp: string;
	hasHtml: boolean;
	hasCsv: boolean;
}

export function listReports(): ReportSummary[] {
	if (!existsSync(REPORTS_DIR)) return [];

	const files = readdirSync(REPORTS_DIR);
	const htmlFiles = files.filter(f => f.endsWith('.html'));

	return htmlFiles.map(f => {
		const base = f.replace('.html', '');
		const csvExists = files.includes(`${base}.csv`);

		// Parse filename: strategy-GRANULARITY-YYYY-MM-DD-HH-MM-SS.html
		// or: strategy-YYYY-MM-DD-HH-MM-SS.html (old format without granularity)
		const parts = base.split('-');

		// Find where the date starts (YYYY is 4 digits)
		let dateIdx = parts.findIndex(p => /^\d{4}$/.test(p));
		let strategy = 'unknown';
		let granularity = 'M1';

		if (dateIdx >= 2) {
			// Check if part before date is a granularity (S5, M1, H1, etc.)
			const maybeGran = parts[dateIdx - 1];
			if (/^[SMHDW]\d*$/.test(maybeGran)) {
				granularity = maybeGran;
				strategy = parts.slice(0, dateIdx - 1).join('-');
			} else {
				strategy = parts.slice(0, dateIdx).join('-');
			}
		}

		const timestamp = dateIdx >= 0
			? parts.slice(dateIdx).join('-').replace(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/, '$1-$2-$3T$4:$5:$6')
			: '';

		return {
			filename: base,
			strategy,
			granularity,
			timestamp,
			hasHtml: true,
			hasCsv: csvExists,
		};
	}).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getReportHtml(filename: string): string | null {
	const path = join(REPORTS_DIR, `${filename}.html`);
	if (!existsSync(path)) return null;
	return readFileSync(path, 'utf-8');
}

export function getReportCsv(filename: string): string | null {
	const path = join(REPORTS_DIR, `${filename}.csv`);
	if (!existsSync(path)) return null;
	return readFileSync(path, 'utf-8');
}
