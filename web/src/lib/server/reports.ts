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
	metrics?: ReportMetrics;
	backtestConfig?: ReportConfig;
	strategyConfig?: Record<string, unknown>;
	paramDescriptions?: Record<string, string>;
}

function userBacktestsDir(userId: string): string {
	return join(USERS_DIR, userId, 'backtests');
}

function userReportsDir(userId: string): string {
	return join(USERS_DIR, userId, 'reports');
}

export function listReports(userId: string): ReportSummary[] {
	const btDir = userBacktestsDir(userId);
	if (!existsSync(btDir)) return [];

	const jsonFiles = readdirSync(btDir).filter(f => f.endsWith('.json'));

	return jsonFiles.map(f => {
		const base = f.replace('.json', '');

		// Parse filename: strategy-GRANULARITY-epochMs-configHash.json
		// e.g. london-breakout-M5-1710712010123-a1b2c3d4.json
		const parts = base.split('-');

		// Find the epoch timestamp (13+ digit number)
		const epochIdx = parts.findIndex(p => /^\d{10,}$/.test(p));
		let strategy = 'unknown';
		let granularity = 'M1';
		let timestamp = '';

		if (epochIdx >= 2) {
			const maybeGran = parts[epochIdx - 1];
			if (/^[SMHDW]\d*$/.test(maybeGran)) {
				granularity = maybeGran;
				strategy = parts.slice(0, epochIdx - 1).join('-');
			} else {
				strategy = parts.slice(0, epochIdx).join('-');
			}
			timestamp = new Date(parseInt(parts[epochIdx])).toISOString();
		}

		let metrics: ReportMetrics | undefined;
		let backtestConfig: ReportConfig | undefined;
		let strategyConfig: Record<string, unknown> | undefined;
		let paramDescriptions: Record<string, string> | undefined;

		try {
			const json = JSON.parse(readFileSync(join(btDir, f), 'utf-8'));
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
			if (json.paramDescriptions) {
				paramDescriptions = json.paramDescriptions;
			}
		} catch {
			// skip malformed JSON
		}

		return {
			filename: base,
			strategy,
			granularity,
			timestamp,
			metrics,
			backtestConfig,
			strategyConfig,
			paramDescriptions,
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
