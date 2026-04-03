# My Custom Firefox — Firefox Extension

## Run it in Firefox (temporary add-on)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `my-custom-firefox/manifest.json`
4. Click the toolbar button **My Custom Firefox** (opens a small window)
5. Use that window to manage favicons

## Rename a tab (right-click)

1. Right-click any tab
2. Click **Rename Tab**
3. Enter a new name and press **OK** (leave it blank to reset)

Notes:

- Renaming works on normal web pages. Firefox restricts extensions on some internal pages like `about:` so renaming won’t work there.

## Customize favicons

### Change a site’s favicon locally (tabs)

1. Open a page (the URL will auto-fill in the popup)
2. Click the toolbar button **My Custom Firefox**
3. Drop/select an image, pick a size, then click **Change Local Favicon**

Notes:

- Rules are saved in `storage.local` for this Firefox profile.
- Rules match by domain (e.g. `example.com`) and apply to subdomains too (e.g. `mail.example.com`).
- “Use regex pattern” lets you target multiple URLs (invalid regex patterns are ignored).

### Create a bookmark with a custom favicon

Removed (it relied on an external redirect service).

## Where to see logs

- Open `about:debugging#/runtime/this-firefox`
- Find **My Custom Firefox** → **Inspect** to open the extension debugger
- The background script logs: “Hello World extension loaded.”
