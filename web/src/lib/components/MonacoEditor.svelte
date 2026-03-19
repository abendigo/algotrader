<script lang="ts">
	import { onMount, onDestroy } from "svelte";

	interface Props {
		value: string;
		types?: Record<string, string>;
		onchange?: (value: string) => void;
		onsave?: () => void;
	}

	let { value = $bindable(), types = {}, onchange, onsave }: Props = $props();

	let container: HTMLDivElement;
	let editor: any;
	let monaco: any;
	let ignoreChange = false;

	// Sync external value changes into editor
	$effect(() => {
		if (editor && value !== editor.getValue()) {
			ignoreChange = true;
			editor.setValue(value);
			ignoreChange = false;
		}
	});

	onMount(async () => {
		monaco = await import("monaco-editor");

		// Setup web workers
		self.MonacoEnvironment = {
			getWorker(_moduleId: string, label: string) {
				if (label === "typescript" || label === "javascript") {
					return new Worker(
						new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
						{ type: "module" },
					);
				}
				return new Worker(
					new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
					{ type: "module" },
				);
			},
		};

		// Configure TypeScript compiler options with path mapping for #-prefixed imports
		monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
			target: monaco.languages.typescript.ScriptTarget.ES2022,
			module: monaco.languages.typescript.ModuleKind.ES2015,
			moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
			strict: true,
			allowNonTsExtensions: true,
			baseUrl: "file:///",
			paths: {
				"#core/*": ["types/core/*"],
				"#data/*": ["types/data/*"],
				"#backtest/*": ["types/backtest/*"],
			},
		});

		// Register type definition files
		for (const [moduleId, content] of Object.entries(types)) {
			// "#core/strategy.js" -> "file:///types/core/strategy.ts"
			const virtualPath = moduleId.replace(/^#/, "types/").replace(/\.js$/, ".ts");
			monaco.languages.typescript.typescriptDefaults.addExtraLib(
				content as string,
				`file:///${virtualPath}`,
			);
		}

		// Disable some noisy diagnostics for strategy files
		monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
			diagnosticCodesToIgnore: [
				1375, // 'await' expressions are only allowed at the top level of a file
				2307, // Cannot find module (for any unresolved #-imports we didn't bundle)
			],
		});

		// Define a dark theme matching the app
		monaco.editor.defineTheme("algotrader-dark", {
			base: "vs-dark",
			inherit: true,
			rules: [],
			colors: {
				"editor.background": "#0d1117",
				"editor.foreground": "#c9d1d9",
				"editorLineNumber.foreground": "#484f58",
				"editorLineNumber.activeForeground": "#8b949e",
				"editor.selectionBackground": "#264f78",
				"editor.lineHighlightBackground": "#161b22",
				"editorWidget.background": "#161b22",
				"editorWidget.border": "#30363d",
			},
		});

		editor = monaco.editor.create(container, {
			value,
			language: "typescript",
			theme: "algotrader-dark",
			minimap: { enabled: false },
			fontSize: 13,
			lineNumbers: "on",
			scrollBeyondLastLine: false,
			automaticLayout: true,
			tabSize: 2,
			padding: { top: 12 },
		});

		// Emit changes
		editor.onDidChangeModelContent(() => {
			if (ignoreChange) return;
			value = editor.getValue();
			onchange?.(value);
		});

		// Ctrl/Cmd+S to save
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			value = editor.getValue();
			onsave?.();
		});
	});

	onDestroy(() => {
		editor?.dispose();
	});
</script>

<div bind:this={container} class="editor-container"></div>

<style>
	.editor-container {
		width: 100%;
		height: 100%;
		min-height: 400px;
		border: 1px solid #30363d;
		border-radius: 6px;
		overflow: hidden;
	}
</style>
