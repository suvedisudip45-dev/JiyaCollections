import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIXED_PORTALS } from "../deployment/mixed-portals/routing.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(rootDirectory, "mixed-portal-dist");
const staticFiles = ["index.html", "404.html", "_redirects", "_headers", ".htaccess"];

const runNpm = (args, cwd) => {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run the mixed portal build through npm so the npm CLI path is available.");

  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed in ${path.relative(rootDirectory, cwd)}.`);
  }
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const buildPortal = (portal) => {
  const packageDirectory = path.join(rootDirectory, portal.packageName);
  const portalOutput = path.join(outputDirectory, portal.outputDirectory);
  const relativeOutput = path.relative(packageDirectory, portalOutput);

  runNpm(["ci"], packageDirectory);
  runNpm([
    "run",
    "build",
    "--",
    `--base=${portal.basePath}`,
    `--outDir=${relativeOutput}`,
    "--emptyOutDir",
  ], packageDirectory);
};

for (const portal of MIXED_PORTALS) {
  buildPortal(portal);
}

for (const file of staticFiles) {
  await copyFile(
    path.join(rootDirectory, "deployment", "mixed-portals", file),
    path.join(outputDirectory, file)
  );
}

console.log(`Mixed portal deployment is ready in ${path.relative(rootDirectory, outputDirectory)}.`);
