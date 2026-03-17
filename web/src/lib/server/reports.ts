import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '../../../../data');
const USERS_DIR = join(DATA_DIR, 'users');

export interface ReportMetrics {
	finalBalance: number;
	returnPct: number;
	totalTrades: number;
	winRate: number;
	profitFactor: number;
	maxDrawdownPct: number;
	sharpeRatio: number;
}

export interface ReportConfig {
	spreadMultiplier: number;
	executionDelay: number;
	timeVaryingSpread: boolean;
	slippagePips?: number;
	fromDate?: string;
	toDate?: string;
}

export interface ReportSummary {
	filename: string;
	strategy: string;
	granularity: string;
	timestamp: string;
	hasHtml: boolean;
	hasCsv: boolean;
	metrics?: ReportMetrics;
	backtestConfig?: ReportConfig;
	strategyConfig?: Record<string, unknown>;
}

function userReportsDir(userId: string): string {
	return join(USERS_DIR, userId, 'reports');
}

export function listReports(userId: string): ReportSummary[] {
	const reportsDir = userReportsDir(userId);
	if (!existsSync(reportsDir)) return [];

	const files = readdirSync(reportsDir);
	const htmlFiles = files.filter(f => f.endsWith('.html'));

	return htmlFiles.map(f => {
		const base = f.replace('.html', '');
		const csvExists = files.includes(`${base}.csv`);
		const jsonExists = files.includes(`${base}.json`);

		// Parse filename: strategy-GRANULARITY-YYYY-MM-DD-HH-MM-SS.html
		const parts = base.split('-');

		let dateIdx = parts.findIndex(p => /^\d{4}$/.test(p));
		let strategy = 'unknown';
		let granularity = 'M1';

		if (dateIdx >= 2) {
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

		let metrics: ReportMetrics | undefined;
		let backtestConfig: ReportConfig | undefined;

		let strategyConfig: Record<string, unknown> | undefined;

		if (jsonExists) {
			try {
				const json = JSON.parse(readFileSync(join(reportsDir, `${base}.json`), 'utf-8'));
				const r = json.result;
				if (r) {
					metrics = {
						finalBalance: r.finalBalance,
						returnPct: r.returnPct,
						totalTrades: r.totalTrades,
						winRate: r.winRate,
						profitFactor: r.profitFactor,
						maxDrawdownPct: r.maxDrawdownPct,
						sharpeRatio: r.sharpeRatio,
					};
					if (r.config) {
						backtestConfig = {
							spreadMultiplier: r.config.spreadMultiplier ?? 1,
							executionDelay: r.config.executionDelay ?? 0,
							timeVaryingSpread: r.config.timeVaryingSpread ?? false,
							slippagePips: r.config.slippagePips,
							fromDate: r.config.fromDate ?? (r.startTime ? new Date(r.startTime).toISOString().slice(0, 10) : undefined),
							toDate: r.config.toDate ?? (r.endTime ? new Date(r.endTime).toISOString().slice(0, 10) : undefined),
						};
					}
				}
				if (json.strategyConfig) {
					strategyConfig = json.strategyConfig;
				}
			} catch {
				// skip malformed JSON
			}
		}

		return {
			filename: base,
			strategy,
			granularity,
			timestamp,
			hasHtml: true,
			hasCsv: csvExists,
			metrics,
			backtestConfig,
			strategyConfig,
		};
	}).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getReportHtml(userId: string, filename: string): string | null {
	const path = join(userReportsDir(userId), `${filename}.html`);
	if (!existsSync(path)) return null;
	return readFileSync(path, 'utf-8');
}

export function getReportCsv(userId: string, filename: string): string | null {
	const path = join(userReportsDir(userId), `${filename}.csv`);
	if (!existsSync(path)) return null;
	return readFileSync(path, 'utf-8');
}
