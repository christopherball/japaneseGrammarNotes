# Japanese Grammar Notes

This repository now powers a static single-page site for grammar reference notes.
The notes themselves live in `content/notes/*.html`, while the home page and routing
are driven by `content/notes.json`.

## Local Preview

1. Run `npm install`
2. Run `python3 -m http.server 4173`
3. Open `http://127.0.0.1:4173/`

Opening `index.html` directly from Finder will not work correctly because the app
fetches the manifest and note fragments.

## Deployment Build

Run:

```bash
npm run build
```

This creates a clean `dist/` folder containing only the files needed to deploy the
site:

- `index.html`
- `app.js`
- `styles.css`
- `content/`

If you want to preview the built output locally, run:

```bash
npm run serve:dist
```

## Note Workflow

Notes are created from Markdown currently in the macOS clipboard. Markdown is only
an import format. The canonical content stored in the repo is sanitized HTML.

### What `id` / `slug` Means

Each note has a short URL-safe identifier such as `copula-conjugations`.
Internally the project still calls that a `slug`, but in normal CLI usage you can
think of it as the note's page ID.

- `id`: machine-friendly value used in the URL and fragment filename
- `title`: human-friendly value shown on the page
- route: `#/notes/copula-conjugations`
- fragment file: `content/notes/copula-conjugations.html`
- displayed title: `Copula Conjugations`

Real example:

```text
id:    copula-conjugations
title: Copula Conjugations
```

### Create A New Note

1. Copy Markdown from ChatGPT, Claude, or another source.
2. Run:

```bash
npm run notes -- create --title "My New Note" --summary "Short description" --category "Constructions"
```

Optional flags:

- `--id "my-new-note"` to choose the page ID yourself
- `--no-build` to skip the automatic `dist/` rebuild for that command
- omit `--summary` to generate a short excerpt automatically from the imported content
- omit `--category` to use `General`

By default, note create/update/edit/delete commands now rebuild `dist/` automatically
after updating the source files.

### Update An Existing Note

Copy the revised Markdown to your clipboard, then run:

```bash
npm run notes -- update --id "my-note" --title "Optional New Title"
```

Use `update` when you want to replace the page content from fresh clipboard Markdown.
Pass `--no-build` if you want to skip the automatic `dist/` rebuild.

### Edit Note Metadata

Use `edit` when you want to change title, category, summary, or page ID without
touching the note body.

```bash
npm run notes -- edit --id "copula-conjugations" --category "Conjugation"
```

Examples:

```bash
npm run notes -- edit --id "copula-conjugations" --category "Conjugation"
npm run notes -- edit --id "copula-conjugations" --summary "Reference tables for Japanese copula forms."
npm run notes -- edit --id "copula-conjugations" --title "Copula Forms"
npm run notes -- edit --id "copula-conjugations" --new-id "copula-forms"
npm run notes -- edit --id "copula-conjugations" --title "Copula Forms" --new-id "copula-forms"
```

The last example means:

- find the existing note whose current URL ID is `copula-conjugations`
- change the displayed title to `Copula Forms`
- change the URL/file ID to `copula-forms`

### Delete A Note

```bash
npm run notes -- delete --id "my-note"
```

Deleting a note removes both the fragment file and the manifest entry. Pass
`--no-build` if you want to skip the automatic `dist/` rebuild.
