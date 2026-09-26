import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    background: "extension/src/background.js",
    library: "extension/src/ui/library.js",
  },
  bundle: true,
  format: "esm",
  outdir: "dist",
  target: "chrome120",
});
await build({
  entryPoints: ["extension/src/content.js"],
  bundle: true,
  format: "iife",
  outfile: "dist/content.js",
  target: "chrome120",
});
await build({
  entryPoints: ["extension/src/adapters/juicebox-bridge.js"],
  bundle: true,
  format: "iife",
  outfile: "dist/juicebox-bridge.js",
  target: "chrome120",
});
for (const [source, target] of [
  ["extension/manifest.json", "manifest.json"],
  ["extension/src/ui/library.html", "library.html"],
  ["extension/src/ui/library.css", "library.css"],
])
  await copyFile(source, `dist/${target}`);
console.log("Extension built in dist/");
