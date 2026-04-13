#!/usr/bin/env node

import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

    console.log("Built deployable site into dist/");
    for (const target of targets) {
        console.log(`- ${target.destination}`);
    }
    console.log("- content/search-index.json");
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
