import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("build/portable", { recursive: true, force: true });
await mkdir("build/portable", { recursive: true });
await build({
  entryPoints: ["apps/portable/src/app.js"],
  bundle: true,
  format: "esm",
  outfile: "build/portable/app.js",
  target: "chrome100",
});
for (const file of [
  "index.html",
  "app.css",
  "sw.js",
  "icon.svg",
  "manifest.webmanifest",
])
  await copyFile("apps/portable/src/" + file, "build/portable/" + file);
await mkdir("apps/android/app/src/main/assets", { recursive: true });
for (const file of [
  "index.html",
  "app.js",
  "app.css",
  "icon.svg",
  "manifest.webmanifest",
])
  await copyFile(
    "build/portable/" + file,
    "apps/android/app/src/main/assets/" + file,
  );
console.log("Portable Folio built for browser and Android.");
