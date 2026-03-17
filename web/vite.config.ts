import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
	plugins: [sveltekit()],
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
