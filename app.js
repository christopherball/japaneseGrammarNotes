const appElement = document.querySelector("#app");
const manifestUrl = "content/notes.json";
const searchIndexUrl = "content/search-index.json";
const categoryOrder = [
    "Sentence Structure",
    "Particles",
    "Parts of Speech",
    "Conjugation",
    "Constructions"
];

let manifest = [];
let searchIndex = [];
let searchIndexPromise = null;
let isSearchIndexReady = false;
let homeSearchQuery = "";

await init().catch(renderStartupError);

async function init() {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("input", handleDocumentInput);
    window.addEventListener("hashchange", renderCurrentRoute);

    if (window.location.protocol === "file:") {
        renderFileProtocolMessage();
        return;
    }

    await loadManifest();
    void ensureSearchIndexLoaded();
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

async function ensureSearchIndexLoaded() {
    if (searchIndexPromise) {
        return searchIndexPromise;
    }

    searchIndexPromise = loadSearchIndex()
        .catch(() => buildSearchIndexFromFragments())
        .then((entries) => {
            searchIndex = Array.isArray(entries) ? entries : [];
            isSearchIndexReady = true;
            return searchIndex;
        })
        .catch(() => {
            searchIndex = [];
            isSearchIndexReady = true;
            return searchIndex;
        })
        .finally(() => {
            if (parseRoute(window.location.hash).type === "home") {
                updateHomeSearchResults();
            }
        });

    return searchIndexPromise;
}

async function loadSearchIndex() {
    const response = await fetch(searchIndexUrl, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Unable to load search index (${response.status}).`);
    }

    const entries = await response.json();
    return Array.isArray(entries) ? entries : [];
}

async function buildSearchIndexFromFragments() {
    const entries = await Promise.all(
        manifest.map(async (note) => {
            try {
                const fragment = await fetchFragment(note.fragmentPath);
                return createSearchEntry(note, fragment);
            } catch {
                return createSearchEntry(note, "");
            }
        }),
    );

    return entries;
}

function createSearchEntry(note, fragment) {
    const parser = new DOMParser();
    const documentFragment = parser.parseFromString(`<article>${fragment}</article>`, "text/html");
    const root = documentFragment.body.firstElementChild || documentFragment.body;
    const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")]
        .map((heading) => normalizeWhitespace(heading.textContent || ""))
        .filter(Boolean);

    return {
        slug: note.slug,
        title: note.title,
        summary: note.summary,
        category: note.category,
        headings,
        text: normalizeWhitespace(root.textContent || ""),
    };
}

async function renderCurrentRoute() {
    const route = parseRoute(window.location.hash);

    if (route.type === "home") {
        renderHome();
        return;
    }

    if (route.type === "note") {
        await renderNote(route.slug, route.query);
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

    const noteMatch = hash.match(/^#\/notes\/([^/?#]+)(?:\?([^#]*))?$/);
    if (noteMatch) {
        const params = new URLSearchParams(noteMatch[2] || "");
        return {
            type: "note",
            slug: decodeURIComponent(noteMatch[1]),
            query: (params.get("query") || "").trim(),
        };
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
            const rows = notes.map(renderBrowseRow).join("");

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
                <div class="hero-layout">
                    <div class="hero-intro">
                        <h1>Browse Notes</h1>
                        <p class="hero-copy">
                            Grammar notes, pattern tables, and quick reference pages.
                        </p>
                        <div class="hero-meta">
                            <span class="hero-chip">${totalNotes} note${totalNotes === 1 ? "" : "s"}</span>
                            <span class="hero-chip">${totalCategories} categor${totalCategories === 1 ? "y" : "ies"}</span>
                        </div>
                    </div>
                    <div class="search-panel">
                        <input
                            id="note-search-input"
                            class="search-input"
                            type="search"
                            name="query"
                            value="${escapeHtml(homeSearchQuery)}"
                            placeholder="Try searching for なら, passive, 〜し, or particles"
                            aria-label="Search notes"
                            autocomplete="off"
                            spellcheck="false"
                        />
                    </div>
                </div>
            </header>
            <div class="home-sections">
                <div id="home-search-results" class="home-search-results" hidden></div>
                <div id="home-browse-sections" class="home-browse-sections">
                    ${sections}
                </div>
            </div>
        </section>
    `;

    updateHomeSearchResults();
}

function renderBrowseRow(note) {
    return `
        <article class="note-row">
            <a class="note-link" href="#/notes/${encodeURIComponent(note.slug)}">
                <span class="note-title">${escapeHtml(note.title)}</span>
            </a>
            <p class="note-summary">${escapeHtml(note.summary)}</p>
        </article>
    `;
}

function updateHomeSearchResults() {
    const resultsElement = document.querySelector("#home-search-results");
    const browseElement = document.querySelector("#home-browse-sections");

    if (!resultsElement || !browseElement) {
        return;
    }

    const query = homeSearchQuery.trim();
    if (!query) {
        resultsElement.hidden = true;
        browseElement.hidden = false;
        resultsElement.innerHTML = "";
        return;
    }

    resultsElement.hidden = false;
    browseElement.hidden = true;

    if (!isSearchIndexReady) {
        resultsElement.innerHTML = `
            <section class="empty-state search-state">
                <p>Building a quick search index for the current notes…</p>
            </section>
        `;
        return;
    }

    const results = searchNotes(query);
    resultsElement.innerHTML = renderSearchResults(results, query);
}

function renderSearchResults(results, query) {
    if (results.length === 0) {
        return `
            <section class="empty-state search-state">
                <p>No notes mention <code>${escapeHtml(query)}</code> yet.</p>
            </section>
        `;
    }

    const rows = results.map((result) => renderSearchResultRow(result, query)).join("");
    return `
        <section class="category-section search-results-section">
            <header class="category-header">
                <h2 class="category-title">Search Results</h2>
            </header>
            <div class="note-list">
                ${rows}
            </div>
        </section>
    `;
}

function renderSearchResultRow(result, query) {
    const href = `#/notes/${encodeURIComponent(result.slug)}?query=${encodeURIComponent(query)}`;
    const matchLine = result.matchLabel
        ? `<p class="search-match">Matched in ${escapeHtml(result.matchLabel)}</p>`
        : "";
    const snippet = result.displayText
        ? `<p class="search-snippet">${highlightSearchText(result.displayText, query)}</p>`
        : "";
    const copy = snippet ? `<div class="search-copy">${snippet}</div>` : "";
    const rowClass = snippet ? "note-row search-result-row" : "note-row search-result-row search-result-row-compact";

    return `
        <article class="${rowClass}">
            <a class="note-link" href="${href}">
                <span class="note-title">${highlightSearchText(result.title, query)}</span>
                ${matchLine}
            </a>
            ${copy}
        </article>
    `;
}

function searchNotes(query) {
    const normalizedQuery = normalizeSearchValue(query);
    if (!normalizedQuery) {
        return [];
    }

    return searchIndex
        .map((entry) => rankSearchEntry(entry, normalizedQuery, query))
        .filter(Boolean)
        .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function rankSearchEntry(entry, normalizedQuery, rawQuery) {
    let score = 0;
    let matchLabel = "";
    let snippet = "";

    const titleIndex = normalizeSearchValue(entry.title).indexOf(normalizedQuery);
    if (titleIndex !== -1) {
        score += scoreMatch(500, titleIndex);
        matchLabel ||= "title";
    }

    const headingMatch = findFirstListMatch(entry.headings, normalizedQuery);
    if (headingMatch) {
        score += scoreMatch(320, headingMatch.index);
        matchLabel ||= "section heading";
        snippet ||= headingMatch.value;
    }

    const summaryIndex = normalizeSearchValue(entry.summary).indexOf(normalizedQuery);
    if (summaryIndex !== -1) {
        score += scoreMatch(220, summaryIndex);
        matchLabel ||= "summary";
        snippet ||= entry.summary;
    }

    const categoryIndex = normalizeSearchValue(entry.category).indexOf(normalizedQuery);
    if (categoryIndex !== -1) {
        score += scoreMatch(140, categoryIndex);
        matchLabel ||= "category";
    }

    const textIndex = normalizeSearchValue(entry.text).indexOf(normalizedQuery);
    if (textIndex !== -1) {
        score += scoreMatch(120, textIndex);
        matchLabel ||= "note content";
        snippet ||= buildSearchSnippet(entry.text, textIndex, rawQuery.length);
    }

    if (score === 0) {
        return null;
    }

    return {
        slug: entry.slug,
        title: entry.title,
        matchLabel,
        displayText: snippet,
        score,
    };
}

function scoreMatch(weight, index) {
    return Math.max(1, weight - Math.min(index, weight - 1));
}

function findFirstListMatch(values, normalizedQuery) {
    for (const value of values) {
        const index = normalizeSearchValue(value).indexOf(normalizedQuery);
        if (index !== -1) {
            return { value, index };
        }
    }

    return null;
}

function buildSearchSnippet(text, matchIndex, queryLength) {
    const radius = 72;
    const start = Math.max(0, matchIndex - radius);
    const end = Math.min(text.length, matchIndex + queryLength + radius);
    let snippet = text.slice(start, end).trim();

    if (start > 0) {
        snippet = `…${snippet}`;
    }
    if (end < text.length) {
        snippet = `${snippet}…`;
    }

    return snippet;
}

async function renderNote(slug, searchQuery = "") {
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
        if (searchQuery) {
            focusFirstSearchMatch(contentElement, searchQuery);
        }
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

function focusFirstSearchMatch(container, query) {
    const normalizedQuery = normalizeSearchValue(query);
    if (!normalizedQuery) {
        return;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || parent.closest("mark, script, style")) {
                return NodeFilter.FILTER_REJECT;
            }

            const text = node.nodeValue || "";
            if (!text.trim()) {
                return NodeFilter.FILTER_REJECT;
            }

            return normalizeSearchValue(text).includes(normalizedQuery)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP;
        },
    });

    let node;
    while ((node = walker.nextNode())) {
        const originalText = node.nodeValue || "";
        const match = originalText.match(new RegExp(escapeRegExp(query.trim()), "iu"));
        if (!match || typeof match.index !== "number") {
            continue;
        }

        const matchIndex = match.index;
        const before = originalText.slice(0, matchIndex);
        const matchText = match[0];
        const after = originalText.slice(matchIndex + matchText.length);
        const marker = document.createElement("mark");
        marker.className = "note-hit";
        marker.textContent = matchText;

        const fragment = document.createDocumentFragment();
        if (before) {
            fragment.append(before);
        }
        fragment.append(marker);
        if (after) {
            fragment.append(after);
        }

        node.parentNode.replaceChild(fragment, node);
        focusSearchMarker(marker);
        return;
    }
}

function focusSearchMarker(marker) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            marker.scrollIntoView({ behavior: "smooth", block: "start", inline: "center" });
        });
    });
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

function normalizeWhitespace(value) {
    return String(value).replace(/\s+/g, " ").trim();
}

function normalizeSearchValue(value) {
    return normalizeWhitespace(value).toLocaleLowerCase();
}

function highlightSearchText(text, query) {
    const source = String(text);
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        return escapeHtml(source);
    }

    const matcher = new RegExp(escapeRegExp(trimmedQuery), "giu");
    let result = "";
    let lastIndex = 0;
    let match;

    while ((match = matcher.exec(source)) !== null) {
        const start = match.index;
        const value = match[0];
        result += escapeHtml(source.slice(lastIndex, start));
        result += `<mark class="search-hit">${escapeHtml(value)}</mark>`;
        lastIndex = start + value.length;
    }

    result += escapeHtml(source.slice(lastIndex));
    return result;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function handleDocumentInput(event) {
    const input = event.target.closest("#note-search-input");
    if (!input) {
        return;
    }

    homeSearchQuery = input.value;
    if (homeSearchQuery.trim()) {
        void ensureSearchIndexLoaded();
    }
    updateHomeSearchResults();
}
