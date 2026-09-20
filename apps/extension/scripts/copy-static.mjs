import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

const mode = process.argv[2] ?? "development";
if (!["development", "production"].includes(mode)) {
  throw new Error(`Unsupported build mode: ${mode}`);
}

// Read only the selected file and emit only this public value, never all env vars.
const envFile = `.env.${mode}`;
const { API_BASE_URL } = parseEnv(readFileSync(envFile, "utf8"));
if (!API_BASE_URL) {
  throw new Error(`API_BASE_URL is required in ${envFile}`);
}
const apiUrl = new URL(API_BASE_URL);
if (!["http:", "https:"].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
  throw new Error(`API_BASE_URL in ${envFile} must be an HTTP(S) URL without credentials, query, or fragment`);
}

const files = [
  "popup/popup.html",
  "popup/popup.css",
];

for (const file of files) {
  const source = resolve("src", file);
  const target = resolve("dist", file);

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

writeFileSync(resolve("dist/env.js"),
  `// Generated from ${envFile}; public extension configuration.\nexport const BUILD_ENV = ${JSON.stringify(mode)};\nexport const API_BASE_URL = ${JSON.stringify(API_BASE_URL.replace(/\/+$/, ""))};\n`);

// The source manifest supports loading the project folder; the packaged manifest
// uses paths relative to dist so that dist itself can be loaded in Chrome.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const distPath = (path) => path.replace(/^dist\//, "");
manifest.background.service_worker = distPath(manifest.background.service_worker);
manifest.action.default_popup = distPath(manifest.action.default_popup);
for (const script of manifest.content_scripts) {
  script.js = script.js.map(distPath);
}
for (const resource of manifest.web_accessible_resources) {
  resource.resources = resource.resources.map(distPath);
}
writeFileSync(resolve("dist/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${mode} extension in dist (API: ${API_BASE_URL})`);
