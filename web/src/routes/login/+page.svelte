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
		background: #161b22;
		border: 1px solid #21262d;
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
		background: #5d1a1a;
		color: #f85149;
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
		color: #8b949e;
		margin-bottom: 4px;
	}
	input {
		width: 100%;
		padding: 8px 12px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.95em;
		box-sizing: border-box;
	}
	input:focus {
		outline: none;
		border-color: #58a6ff;
	}
	button {
		width: 100%;
		padding: 10px;
		background: #238636;
		color: #fff;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.95em;
		cursor: pointer;
		margin-top: 4px;
	}
	button:hover {
		background: #2ea043;
	}
	.footer {
		text-align: center;
		font-size: 0.85em;
		color: #8b949e;
		margin-top: 16px;
	}
</style>
