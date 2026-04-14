#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, "dist");
const manifestPath = path.join(repoRoot, "content", "notes.json");
const searchIndexDestination = path.join(distRoot, "content", "search-index.json");

const targets = [
    { source: "index.html", destination: "index.html", type: "file" },
    { source: "app.js", destination: "app.js", type: "file" },
    { source: "styles.css", destination: "styles.css", type: "file" },
    { source: "content", destination: "content", type: "directory" },
];

await buildDist();

async function buildDist() {
    const buildVersion = await createBuildVersion();

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

    await writeSearchIndex();
    await stampIndexHtml(buildVersion);

    console.log("Built deployable site into dist/");
    for (const target of targets) {
        console.log(`- ${target.destination}`);
    }
    console.log("- content/search-index.json");
    console.log(`- build version: ${buildVersion}`);
}

async function assertExists(filePath, label) {
    try {
        await stat(filePath);
    } catch {
        throw new Error(`Missing build input: ${label}`);
    }
}

async function writeSearchIndex() {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const searchIndex = await Promise.all(
        manifest.map(async (note) => {
            const fragment = await readFile(path.join(repoRoot, note.fragmentPath), "utf8");
            return createSearchEntry(note, fragment);
        }),
    );

    await mkdir(path.dirname(searchIndexDestination), { recursive: true });
    await writeFile(searchIndexDestination, `${JSON.stringify(searchIndex, null, 2)}\n`);
}

async function createBuildVersion() {
    const hash = createHash("sha256");
    const inputFiles = await collectBuildInputFiles();

    for (const filePath of inputFiles) {
        hash.update(path.relative(repoRoot, filePath));
        hash.update("\n");
        hash.update(await readFile(filePath));
        hash.update("\n");
    }

    return hash.digest("hex").slice(0, 12);
}

async function collectBuildInputFiles() {
    const files = [];

    for (const target of targets) {
        const sourcePath = path.join(repoRoot, target.source);

        await assertExists(sourcePath, target.source);

        if (target.type === "directory") {
            files.push(...(await listFilesRecursive(sourcePath)));
            continue;
        }

        files.push(sourcePath);
    }

    return files.sort((left, right) => left.localeCompare(right));
}

async function listFilesRecursive(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
    const files = [];

    for (const entry of sortedEntries) {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await listFilesRecursive(entryPath)));
            continue;
        }

        if (entry.isFile()) {
            files.push(entryPath);
        }
    }

    return files;
}

async function stampIndexHtml(buildVersion) {
    const distIndexPath = path.join(distRoot, "index.html");
    const originalHtml = await readFile(distIndexPath, "utf8");
    const stampedHtml = originalHtml
        .replace('href="styles.css"', `href="styles.css?v=${buildVersion}"`)
        .replace('src="app.js"', `src="app.js?v=${buildVersion}"`);

    if (stampedHtml === originalHtml) {
        throw new Error("Unable to apply cache-busting URLs to dist/index.html.");
    }

    await writeFile(distIndexPath, stampedHtml);
}

function createSearchEntry(note, fragment) {
    const headings = [...fragment.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)]
        .map(([, , text]) => cleanText(text))
        .filter(Boolean);

    return {
        slug: note.slug,
        title: note.title,
        summary: note.summary,
        category: note.category,
        headings,
        text: cleanText(fragment),
    };
}

function cleanText(value) {
    return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(value) {
    return value
        .replaceAll("&nbsp;", " ")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'");
}
