import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execSync } from 'child_process';

const gitSha = process.env.GIT_SHA ?? (() => {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return 'unknown';
	}
})();

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__GIT_SHA__: JSON.stringify(gitSha),
	},
	resolve: {
		alias: {
			'$engine': resolve(__dirname, '../src'),
		}
	},
	server: {
		fs: {
			// Allow serving files from the parent project
			allow: [resolve(__dirname, '..')]
		}
	}
});
