import { spawn } from "node:child_process";
import { access, mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
const sdk = process.env.ANDROID_HOME ?? homedir() + "/Android/Sdk";
const gradle = process.env.FOLIO_GRADLE ?? resolve("apps/android/gradlew");
try {
  await access(gradle);
} catch {
  throw new Error(
    "Set FOLIO_GRADLE to a Gradle 8.10.2 executable, or use Android Studio to build apps/android",
  );
}
const env = { ...process.env, ANDROID_HOME: sdk };

const child = spawn(gradle, ["--no-daemon", "assembleDebug"], {
  cwd: "apps/android",
  env,
  stdio: "inherit",
});
const code = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", resolve);
});
if (code) process.exit(code);
await mkdir("build/android", { recursive: true });
await copyFile(
  "apps/android/app/build/outputs/apk/debug/app-debug.apk",
  "build/android/Folio-debug.apk",
);
console.log("APK: build/android/Folio-debug.apk");
