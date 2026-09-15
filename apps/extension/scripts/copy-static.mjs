import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
