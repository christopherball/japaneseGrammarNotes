#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sanitizeHtml from "sanitize-html";
import { marked } from "marked";

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const buildScriptPath = path.join(repoRoot, "scripts", "build-dist.mjs");
const manifestPath = path.join(repoRoot, "content", "notes.json");
const notesDirectory = path.join(repoRoot, "content", "notes");
const booleanOptions = new Set(["no-build"]);

marked.setOptions({
    gfm: true,
});

const allowedTags = [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "rp",
    "rt",
    "ruby",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
];

const allowedAttributes = {
    a: ["href", "title"],
    div: ["class"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    h5: ["id"],
    h6: ["id"],
    ol: ["start"],
    p: ["class"],
    span: ["class"],
    table: ["class"],
    td: ["colspan", "rowspan", "align"],
    th: ["colspan", "rowspan", "scope", "align"],
};

const allowedClasses = {
    div: ["callout", "warning"],
    p: ["lead"],
    span: ["pattern"],
};

async function main() {
    try {
        const [command, ...args] = process.argv.slice(2);
        if (!command) {
            printUsage();
            process.exitCode = 1;
            return;
        }

        await ensureStructure();

        switch (command) {
            case "create":
                await createNote(parseArgs(args));
                break;
            case "update":
                await updateNote(parseArgs(args));
                break;
            case "edit":
                await editNote(parseArgs(args));
                break;
            case "delete":
                await deleteNote(parseArgs(args));
                break;
            default:
                throw new Error(`Unknown command "${command}".`);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exitCode = 1;
    }
}

async function ensureStructure() {
    await mkdir(notesDirectory, { recursive: true });

    try {
        await stat(manifestPath);
    } catch {
        await writeFile(manifestPath, "[]\n");
    }
}

async function createNote(options) {
    const title = requireOption(options.title, "--title is required for create.");
    const slug = options.slug || options.id || slugify(title);
    const category = options.category || "General";
    const markdown = await readClipboardMarkdown();
    const manifest = await readManifest();

    if (findNoteBySlug(manifest, slug)) {
        throw new Error(`A note with slug "${slug}" already exists.`);
    }

    const fragmentPath = relativeFragmentPath(slug);
    const summary = options.summary || inferSummary(markdown, title);
    const now = new Date().toISOString();

    await writeFragment(slug, markdown);
    manifest.push({
        slug,
        title,
        summary,
        category,
        fragmentPath,
        createdAt: now,
        updatedAt: now,
    });
    await writeManifest(manifest);

    await finalizeMutation(options, `Created note "${title}" at ${fragmentPath}`);
}

async function updateNote(options) {
    const slug = requireOption(
        options.slug || options.id,
        "--id (or --slug) is required for update.",
    );
    const manifest = await readManifest();
    const note = findNoteBySlug(manifest, slug);

    if (!note) {
        throw new Error(`No note exists with slug "${slug}".`);
    }

    const markdown = await readClipboardMarkdown();

    note.title = options.title || note.title;
    note.summary = options.summary || inferSummary(markdown, note.title);
    note.category = options.category || note.category || "General";
    note.updatedAt = new Date().toISOString();

    await writeFragment(slug, markdown);
    await writeManifest(manifest);

    await finalizeMutation(options, `Updated note "${note.title}" (${slug}).`);
}

async function editNote(options) {
    const slug = requireOption(
        options.slug || options.id,
        "--id (or --slug) is required for edit.",
    );
    const manifest = await readManifest();
    const note = findNoteBySlug(manifest, slug);

    if (!note) {
        throw new Error(`No note exists with id "${slug}".`);
    }

    const newSlug = options["new-slug"] || options["new-id"] || slug;
    if (newSlug !== slug && findNoteBySlug(manifest, newSlug)) {
        throw new Error(`A note with id "${newSlug}" already exists.`);
    }

    if (
        !options.title &&
        !options.summary &&
        !options.category &&
        newSlug === slug
    ) {
        throw new Error(
            "edit requires at least one of --title, --summary, --category, or --new-id.",
        );
    }

    if (newSlug !== slug) {
        const oldPath = path.join(repoRoot, note.fragmentPath);
        const nextPath = path.join(notesDirectory, `${newSlug}.html`);
        await rename(oldPath, nextPath);
        note.slug = newSlug;
        note.fragmentPath = relativeFragmentPath(newSlug);
    }

    if (options.title) {
        note.title = options.title;
    }
    if (options.summary) {
        note.summary = options.summary;
    }
    if (options.category) {
        note.category = options.category;
    }
    note.updatedAt = new Date().toISOString();

    await writeManifest(manifest);

    await finalizeMutation(options, `Edited note "${slug}".`);
}

async function deleteNote(options) {
    const slug = requireOption(
        options.slug || options.id,
        "--id (or --slug) is required for delete.",
    );
    const manifest = await readManifest();
    const index = manifest.findIndex((entry) => entry.slug === slug);

    if (index === -1) {
        throw new Error(`No note exists with slug "${slug}".`);
    }

    const [note] = manifest.splice(index, 1);
    await rm(path.join(repoRoot, note.fragmentPath), { force: true });
    await writeManifest(manifest);

    await finalizeMutation(options, `Deleted note "${slug}".`);
}

async function writeFragment(slug, markdown) {
    const sanitizedHtml = renderHtmlFragment(markdown);
    const fragmentFile = path.join(notesDirectory, `${slug}.html`);
    await writeFile(fragmentFile, `${sanitizedHtml}\n`);
}

function renderHtmlFragment(markdown) {
    const rawHtml = marked.parse(markdown.trim());
    const safeHtml = sanitizeHtml(rawHtml, {
        allowedTags,
        allowedAttributes,
        allowedClasses,
        allowedSchemes: ["http", "https", "mailto"],
    });

    return wrapTables(safeHtml);
}

function wrapTables(html) {
    return html.replaceAll(
        /<table([\s\S]*?)>([\s\S]*?)<\/table>/g,
        '<div class="table-scroll"><table$1>$2</table></div>',
    );
}

async function readManifest() {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
}

async function writeManifest(manifest) {
    const sorted = [...manifest].sort((left, right) => {
        const categoryCompare = (left.category || "General").localeCompare(
            right.category || "General",
        );
        if (categoryCompare !== 0) {
            return categoryCompare;
        }

        const titleCompare = left.title.localeCompare(right.title);
        if (titleCompare !== 0) {
            return titleCompare;
        }

        return left.slug.localeCompare(right.slug);
    });

    await writeFile(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
}

function findNoteBySlug(manifest, slug) {
    return manifest.find((entry) => entry.slug === slug);
}

async function readClipboardMarkdown() {
    let stdout = "";

    try {
        ({ stdout } = await execFileAsync("pbpaste"));
    } catch (error) {
        throw new Error(
            `Unable to read the macOS clipboard via pbpaste: ${error.message}`,
        );
    }

    const markdown = stdout.trim();
    if (!markdown) {
        throw new Error("Clipboard is empty. Copy your Markdown first.");
    }

    return markdown;
}

function inferSummary(markdown, title) {
    const stripped = markdown
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\|/g, " ")
        .replace(/[*_`>#-]/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!stripped) {
        return `${title} reference note.`;
    }

    return stripped.slice(0, 155).trim();
}

function relativeFragmentPath(slug) {
    return `content/notes/${slug}.html`;
}

async function finalizeMutation(options, successMessage) {
    if (options["no-build"]) {
        console.log(`${successMessage}\nSkipped dist rebuild (--no-build).`);
        return;
    }

    try {
        await rebuildDist();
    } catch (error) {
        throw new Error(
            `${successMessage}\nSource files were updated, but rebuilding dist failed: ${error.message}`,
        );
    }

    console.log(`${successMessage}\nRebuilt dist/.`);
}

async function rebuildDist() {
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [buildScriptPath], {
            cwd: repoRoot,
        });

        if (stdout) {
            process.stdout.write(stdout);
        }
        if (stderr) {
            process.stderr.write(stderr);
        }
    } catch (error) {
        const detail = [error.stdout, error.stderr, error.message]
            .filter(Boolean)
            .join("\n")
            .trim();
        throw new Error(detail || "Unknown dist build failure.");
    }
}

function requireOption(value, message) {
    if (!value) {
        throw new Error(message);
    }

    return value;
}

function parseArgs(args) {
    const options = {};

    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token.startsWith("--")) {
            throw new Error(`Unexpected argument "${token}".`);
        }

        const key = token.slice(2);
        if (booleanOptions.has(key)) {
            options[key] = true;
            continue;
        }

        const value = args[index + 1];
        if (!value || value.startsWith("--")) {
            throw new Error(`Expected a value after "${token}".`);
        }

        options[key] = value;
        index += 1;
    }

    return options;
}

function slugify(value) {
    return value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function printUsage() {
    console.log(`Usage:
  node scripts/notes.mjs create --title "My Note" [--id "my-note"] [--summary "..."] [--category "Grammar"] [--no-build]
  node scripts/notes.mjs update --id "my-note" [--title "New title"] [--summary "..."] [--category "Grammar"] [--no-build]
  node scripts/notes.mjs edit --id "my-note" [--title "New title"] [--summary "..."] [--category "Grammar"] [--new-id "new-id"] [--no-build]
  node scripts/notes.mjs delete --id "my-note" [--no-build]`);
}

await main();
