#!/usr/bin/env node

import { copyFile, cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, "dist");

const targets = [
    { source: "index.html", destination: "index.html", type: "file" },
    { source: "app.js", destination: "app.js", type: "file" },
    { source: "styles.css", destination: "styles.css", type: "file" },
    { source: "content", destination: "content", type: "directory" },
];

await buildDist();

async function buildDist() {
    await rm(distRoot, { recursive: true, force: true });
    await mkdir(distRoot, { recursive: true });

    for (const target of targets) {
        const sourcePath = path.join(repoRoot, target.source);
        const destinationPath = path.join(distRoot, target.destination);

        await assertExists(sourcePath, target.source);

        if (target.type === "directory") {
            await cp(sourcePath, destinationPath, { recursive: true });
            continue;
        }

        await mkdir(path.dirname(destinationPath), { recursive: true });
        await copyFile(sourcePath, destinationPath);
    }

    console.log("Built deployable site into dist/");
    for (const target of targets) {
        console.log(`- ${target.destination}`);
    }
}

async function assertExists(filePath, label) {
    try {
        await stat(filePath);
    } catch {
        throw new Error(`Missing build input: ${label}`);
    }
}
