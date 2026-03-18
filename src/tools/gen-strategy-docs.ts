/**
 * Build-time documentation generator.
 *
 * Extracts interface definitions from TypeScript source files using the
 * compiler API, reads type-checked example/snippet files, and outputs
 * a single JSON file consumed by the docs page.
 *
 * Usage: npx tsx src/tools/gen-strategy-docs.ts
 */

import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve, relative, basename } from "path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, "web/src/lib/generated/strategy-docs.json");

// --- TypeScript compiler setup ---

const configPath = join(ROOT, "tsconfig.json");
const configFile = ts.readConfigFile(configPath, (p) => readFileSync(p, "utf-8"));
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();

// --- Interface/type extraction ---

interface MemberInfo {
  name: string;
  type: string;
  doc: string;
  optional: boolean;
  readonly: boolean;
}

interface InterfaceInfo {
  doc: string;
  members: MemberInfo[];
}

interface TypeAliasInfo {
  doc: string;
  definition: string;
}

function getJsDoc(symbol: ts.Symbol): string {
  return ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
}

function extractInterface(sourceFile: ts.SourceFile, name: string): InterfaceInfo | null {
  let result: InterfaceInfo | null = null;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      const symbol = checker.getSymbolAtLocation(node.name);
      const doc = symbol ? getJsDoc(symbol) : "";

      const members: MemberInfo[] = [];
      for (const member of node.members) {
        if (!member.name) continue;
        const memberName = member.name.getText(sourceFile);
        const memberSymbol = checker.getSymbolAtLocation(member.name);

        let typeStr = "";
        if (ts.isPropertySignature(member) && member.type) {
          typeStr = member.type.getText(sourceFile);
        } else if (ts.isMethodSignature(member)) {
          // Build method signature
          const params = member.parameters
            .map((p) => {
              const pName = p.name.getText(sourceFile);
              const pType = p.type ? p.type.getText(sourceFile) : "unknown";
              const optional = p.questionToken ? "?" : "";
              return `${pName}${optional}: ${pType}`;
            })
            .join(", ");
          const retType = member.type ? member.type.getText(sourceFile) : "void";
          typeStr = `(${params}) => ${retType}`;
        }

        members.push({
          name: memberName,
          type: typeStr,
          doc: memberSymbol ? getJsDoc(memberSymbol) : "",
          optional: !!member.questionToken,
          readonly: ts.canHaveModifiers(member)
            ? (ts.getModifiers(member) ?? []).some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
            : false,
        });
      }

      result = { doc, members };
    }
  });

  return result;
}

function extractTypeAlias(sourceFile: ts.SourceFile, name: string): TypeAliasInfo | null {
  let result: TypeAliasInfo | null = null;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === name) {
      const symbol = checker.getSymbolAtLocation(node.name);
      const doc = symbol ? getJsDoc(symbol) : "";
      const definition = node.type.getText(sourceFile);
      result = { doc, definition };
    }
  });

  return result;
}

function extractExportedNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];

  ts.forEachChild(sourceFile, (node) => {
    // exported interfaces
    if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
      names.push(node.name.text);
    }
    // exported type aliases
    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
      names.push(node.name.text);
    }
    // exported classes
    if (ts.isClassDeclaration(node) && hasExportModifier(node) && node.name) {
      names.push(node.name.text);
    }
    // exported const/let/var
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          names.push(decl.name.text);
        }
      }
    }
    // exported functions
    if (ts.isFunctionDeclaration(node) && hasExportModifier(node) && node.name) {
      names.push(node.name.text);
    }
  });

  return names;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    : false;
}

// --- Example / snippet extraction ---

function readExample(filePath: string): string {
  const src = readFileSync(filePath, "utf-8");
  // Strip the leading JSDoc block (file-level description) — keep only the strategy code
  return src.replace(/^\/\*\*[\s\S]*?\*\/\s*\n/, "").trim();
}

function extractSnippets(filePath: string): Record<string, string> {
  const src = readFileSync(filePath, "utf-8");
  const snippets: Record<string, string> = {};

  const regex = /\/\/ @doc-snippet (\S+)\n([\s\S]*?)\/\/ @doc-snippet-end/g;
  let match;
  while ((match = regex.exec(src)) !== null) {
    snippets[match[1]] = match[2].trim();
  }

  return snippets;
}

// --- Source files ---

function getSourceFile(relativePath: string): ts.SourceFile {
  const fullPath = join(ROOT, relativePath);
  const sf = program.getSourceFile(fullPath);
  if (!sf) throw new Error(`Source file not found: ${fullPath}`);
  return sf;
}

// --- Main ---

const strategyTs = getSourceFile("src/core/strategy.ts");
const brokerTs = getSourceFile("src/core/broker.ts");
const typesTs = getSourceFile("src/core/types.ts");

// Extract interfaces
const interfaces: Record<string, InterfaceInfo> = {};

for (const [name, sf] of [
  ["Strategy", strategyTs],
  ["StrategyContext", strategyTs],
  ["StrategyStateSnapshot", strategyTs],
  ["StrategyIndicator", strategyTs],
  ["StrategyPosition", strategyTs],
  ["Broker", brokerTs],
  ["Tick", typesTs],
  ["OrderRequest", typesTs],
  ["OrderResult", typesTs],
  ["Position", typesTs],
  ["AccountSummary", typesTs],
  ["Candle", typesTs],
] as const) {
  const info = extractInterface(sf, name);
  if (info) interfaces[name] = info;
}

// Extract type aliases
const types: Record<string, TypeAliasInfo> = {};

for (const [name, sf] of [
  ["HedgingMode", strategyTs],
  ["RecoveryConfig", strategyTs],
  ["Instrument", typesTs],
  ["Side", typesTs],
  ["OrderType", typesTs],
  ["Granularity", typesTs],
] as const) {
  const info = extractTypeAlias(sf, name);
  if (info) types[name] = info;
}

// Extract imports table — scan source files for exported names
const importSources = [
  { path: "#core/strategy.js", file: "src/core/strategy.ts" },
  { path: "#core/types.js", file: "src/core/types.ts" },
  { path: "#core/broker.js", file: "src/core/broker.ts" },
  { path: "#data/instruments.js", file: "src/data/instruments.ts" },
  { path: "#backtest/types.js", file: "src/backtest/types.ts" },
  { path: "#backtest/broker.js", file: "src/backtest/broker.ts" },
];

const imports = importSources.map(({ path, file }) => {
  try {
    const sf = getSourceFile(file);
    return { path, file, exports: extractExportedNames(sf) };
  } catch {
    return { path, file, exports: [] };
  }
});

// Read example strategy
const examples: Record<string, string> = {
  "example-spread": readExample(join(ROOT, "src/docs/examples/example-spread.ts")),
};

// Read snippets
const allSnippets: Record<string, string> = {};
const snippetsDir = join(ROOT, "src/docs/snippets");
for (const file of readdirSync(snippetsDir).filter((f) => f.endsWith(".ts"))) {
  Object.assign(allSnippets, extractSnippets(join(snippetsDir, file)));
}

// Output
const output = {
  generatedAt: new Date().toISOString(),
  interfaces,
  types,
  imports,
  examples,
  snippets: allSnippets,
};

writeFileSync(OUT, JSON.stringify(output, null, 2));
console.log(`Generated strategy docs JSON: ${relative(ROOT, OUT)}`);
console.log(`  ${Object.keys(interfaces).length} interfaces, ${Object.keys(types).length} types`);
console.log(`  ${Object.keys(examples).length} examples, ${Object.keys(allSnippets).length} snippets`);
console.log(`  ${imports.length} import paths`);
