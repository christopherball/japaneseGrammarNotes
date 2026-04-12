const appElement = document.querySelector("#app");
const manifestUrl = "content/notes.json";
const categoryOrder = [
    "Sentence Structure",
    "Particles",
    "Parts of Speech",
    "Conjugation",
    "Constructions"
];

let manifest = [];

await init().catch(renderStartupError);

async function init() {
    document.addEventListener("click", handleDocumentClick);
    window.addEventListener("hashchange", renderCurrentRoute);

    if (window.location.protocol === "file:") {
        renderFileProtocolMessage();
        return;
    }

    await loadManifest();
    await renderCurrentRoute();
}

async function loadManifest() {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Unable to load note manifest (${response.status}).`);
    }

    const entries = await response.json();
    manifest = Array.isArray(entries) ? entries : [];
}

async function renderCurrentRoute() {
    const route = parseRoute(window.location.hash);

    if (route.type === "home") {
        renderHome();
        return;
    }

    if (route.type === "note") {
        await renderNote(route.slug);
        return;
    }

    renderMissingRoute();
}

function renderFileProtocolMessage() {
    document.title = "Japanese Grammar Notes";
    appElement.innerHTML = `
        <section class="view missing-view">
            <p class="eyebrow">Local Preview</p>
            <h1>Serve this folder over HTTP.</h1>
            <p>
                The app fetches note fragments and the manifest, so opening
                <code>index.html</code> directly from Finder will not work reliably.
                Run <code>python3 -m http.server 4173</code> in this repo and then open
                <code>http://127.0.0.1:4173/</code>.
            </p>
        </section>
    `;
}

function renderStartupError(error) {
    document.title = "Japanese Grammar Notes";
    appElement.innerHTML = `
        <section class="view missing-view">
            <p class="eyebrow">Startup Error</p>
            <h1>The notes app could not load.</h1>
            <p>${escapeHtml(error.message)}</p>
            <a class="action-link" href="#/">Try the home route</a>
        </section>
    `;
}

function parseRoute(rawHash) {
    const hash = normalizeHash(rawHash);

    if (hash === "#/") {
        return { type: "home" };
    }

    const noteMatch = hash.match(/^#\/notes\/([^/?#]+)$/);
    if (noteMatch) {
        return { type: "note", slug: decodeURIComponent(noteMatch[1]) };
    }

    return { type: "missing" };
}

function normalizeHash(rawHash) {
    if (!rawHash || rawHash === "#") {
        return "#/";
    }

    if (rawHash.startsWith("#/")) {
        return rawHash;
    }

    if (rawHash.startsWith("#")) {
        return `#/${rawHash.slice(1).replace(/^\/+/, "")}`;
    }

    return "#/";
}

function renderHome() {
    document.title = "Japanese Grammar Notes";

    if (manifest.length === 0) {
        appElement.innerHTML = `
            <section class="view home-view">
                <header class="hero">
                    <h1>Browse Notes</h1>
                </header>
                <section class="empty-state">
                    <p>No notes have been imported yet.</p>
                </section>
            </section>
        `;
        return;
    }

    const grouped = groupNotesByCategory(manifest);
    const totalNotes = manifest.length;
    const totalCategories = Object.keys(grouped).length;

    const sections = Object.entries(grouped)
        .map(([category, notes]) => {
            const rows = notes
                .map((note) => {
                    return `
                        <article class="note-row">
                            <a class="note-link" href="#/notes/${encodeURIComponent(note.slug)}">
                                <span class="note-title">${escapeHtml(note.title)}</span>
                            </a>
                            <p class="note-summary">${escapeHtml(note.summary)}</p>
                        </article>
                    `;
                })
                .join("");

            return `
                <section class="category-section">
                    <header class="category-header">
                        <h2 class="category-title">${escapeHtml(category)}</h2>
                    </header>
                    <div class="note-list">
                        ${rows}
                    </div>
                </section>
            `;
        })
        .join("");

    appElement.innerHTML = `
        <section class="view home-view">
            <header class="hero">
                <h1>Browse Notes</h1>
                <p class="hero-copy">
                    Grammar notes, pattern tables, and quick reference pages.
                </p>
                <div class="hero-meta">
                    <span class="hero-chip">${totalNotes} note${totalNotes === 1 ? "" : "s"}</span>
                    <span class="hero-chip">${totalCategories} categor${totalCategories === 1 ? "y" : "ies"}</span>
                </div>
            </header>
            <div class="home-sections">
                ${sections}
            </div>
        </section>
    `;
}

async function renderNote(slug) {
    const note = manifest.find((entry) => entry.slug === slug);

    if (!note) {
        renderNoteNotFound(slug);
        return;
    }

    document.title = `${note.title} | Japanese Grammar Notes`;
    appElement.innerHTML = `
        <article class="view note-page">
            <header class="note-header">
                <div class="note-topline">
                    <a class="back-link" href="#/">&larr; Back to all notes</a>
                    <span class="note-category">${escapeHtml(note.category)}</span>
                </div>
                <h1>${escapeHtml(note.title)}</h1>
                <p class="note-subtitle">${escapeHtml(note.summary)}</p>
            </header>
            <section class="note-main">
                <div id="note-content" class="note-content">
                    <p class="note-subtitle">Loading note...</p>
                </div>
            </section>
        </article>
    `;

    const contentElement = document.querySelector("#note-content");

    try {
        const fragment = await fetchFragment(note.fragmentPath);
        contentElement.innerHTML = fragment;
        prepareNoteContent(contentElement);
    } catch (error) {
        contentElement.innerHTML = `
            <div class="callout warning">
                <p><strong>Unable to load note content.</strong></p>
                <p>${escapeHtml(error.message)}</p>
            </div>
        `;
    }
}

async function fetchFragment(fragmentPath) {
    const response = await fetch(fragmentPath, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Missing fragment at ${fragmentPath}.`);
    }

    return response.text();
}

function prepareNoteContent(container) {
    wrapTables(container);

    const headings = [...container.querySelectorAll("h2, h3")];
    const usedIds = new Set();

    headings.forEach((heading) => {
        const baseId = heading.id || slugify(heading.textContent) || "section";
        heading.id = makeUniqueId(baseId, usedIds);
    });
}

function wrapTables(container) {
    for (const table of container.querySelectorAll("table")) {
        if (table.parentElement?.classList.contains("table-scroll")) {
            continue;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    }
}

function renderMissingRoute() {
    document.title = "Not Found | Japanese Grammar Notes";
    appElement.innerHTML = `
        <section class="view missing-view">
            <p class="eyebrow">Not Found</p>
            <h1>That route does not exist.</h1>
            <p>
                Try returning to the notes index and choosing one of the available pages.
            </p>
            <a class="action-link" href="#/">Back to the index</a>
        </section>
    `;
}

function renderNoteNotFound(slug) {
    document.title = "Note Not Found | Japanese Grammar Notes";
    appElement.innerHTML = `
        <section class="view missing-view">
            <p class="eyebrow">Missing Note</p>
            <h1>No note was found for “${escapeHtml(slug)}”.</h1>
            <p>
                The manifest does not contain that slug, or the note may have been deleted.
            </p>
            <a class="action-link" href="#/">Back to the index</a>
        </section>
    `;
}

function groupNotesByCategory(entries) {
    const sorted = [...entries].sort((left, right) => {
        const leftIndex = categoryOrder.indexOf(left.category);
        const rightIndex = categoryOrder.indexOf(right.category);
        const leftSort = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
        const rightSort = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
        const categoryCompare = leftSort - rightSort || left.category.localeCompare(right.category);
        if (categoryCompare !== 0) {
            return categoryCompare;
        }

        return left.title.localeCompare(right.title);
    });

    return sorted.reduce((groups, note) => {
        if (!groups[note.category]) {
            groups[note.category] = [];
        }

        groups[note.category].push(note);
        return groups;
    }, {});
}

function makeUniqueId(baseId, usedIds) {
    let candidate = baseId;
    let counter = 2;

    while (usedIds.has(candidate)) {
        candidate = `${baseId}-${counter}`;
        counter += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function handleDocumentClick(event) {
    const anchor = event.target.closest('a[href^="#"]');
    if (!anchor) {
        return;
    }

    const href = anchor.getAttribute("href");
    if (!href) {
        return;
    }

    if (href.startsWith("#/")) {
        return;
    }

    if (href.startsWith("#")) {
        const target = document.querySelector(href);
        if (target) {
            event.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }
}
