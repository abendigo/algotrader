<script lang="ts">
	import { enhance } from "$app/forms";

	let { form } = $props();
</script>

<div class="auth-page">
	<div class="auth-card">
		<h1>Log In</h1>

		{#if form?.error}
			<div class="error">{form.error}</div>
		{/if}

		<form method="POST" use:enhance>
			<label>
				<span>Email</span>
				<input type="email" name="email" value={form?.email ?? ""} required autocomplete="email" />
			</label>

			<label>
				<span>Password</span>
				<input type="password" name="password" required autocomplete="current-password" />
			</label>

			<button type="submit">Log In</button>
		</form>

		<p class="footer">Don't have an account? <a href="/register">Register</a></p>
	</div>
</div>

<style>
	.auth-page {
		display: flex;
		justify-content: center;
		padding-top: 60px;
	}
	.auth-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 32px;
		width: 100%;
		max-width: 400px;
	}
	h1 {
		font-size: 1.4em;
		margin-bottom: 20px;
		text-align: center;
	}
	.error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 0.85em;
		margin-bottom: 16px;
	}
	label {
		display: block;
		margin-bottom: 16px;
	}
	label span {
		display: block;
		font-size: 0.85em;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	input {
		width: 100%;
		padding: 8px 12px;
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.95em;
		box-sizing: border-box;
	}
	input:focus {
		outline: none;
		border-color: var(--accent);
	}
	button {
		width: 100%;
		padding: 10px;
		background: var(--btn-primary-bg);
		color: #fff;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.95em;
		cursor: pointer;
		margin-top: 4px;
	}
	button:hover {
		background: var(--btn-primary-hover);
	}
	.footer {
		text-align: center;
		font-size: 0.85em;
		color: var(--text-secondary);
		margin-top: 16px;
	}
</style>
