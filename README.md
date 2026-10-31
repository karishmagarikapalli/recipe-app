# Kitchen Ledger

A local-first, single-user kitchen inventory and nutrition journal. Pantry items, food logs, supplements, cookbooks, recipes, and goals are stored in this browser using `localStorage`; no account or hosted database is required. USDA search optionally uses a small server-side Cloudflare Worker proxy so the data.gov key is not exposed in the public static site.

## Run

Open `index.html` in a browser, or serve this folder locally:

```powershell
cd recipe-app
py -m http.server 8000
```

Then visit http://localhost:8000.

## GitHub Pages

In this repository's Settings > Pages, select GitHub Actions as the build source. The [Pages workflow](.github/workflows/pages.yml) runs on pushes to `main` or manually from Actions. It checks JavaScript syntax and runs both the app and Worker test suites before publishing through the `github-pages` environment.

The upload path is `${{ runner.temp }}/recipe-pages` and contains exactly `index.html`, `app.js`, and `app.css`. These are the current local page references; no local icons or manifest are referenced. The repository root, Worker source, tests, backups, `.env`, and `.dev.vars` are never uploaded. Pages requires no USDA or Cloudflare secrets. Manual nutrition entry and local browser storage work without a deployed Worker.

Production Cloudflare deployment is deferred. The Pages workflow does not invoke Wrangler or the separate manual Worker deployment workflow. Keep credentials only in local ignored `.dev.vars` for development until production setup is explicitly authorized. For a local-only proxy, run from this directory:

```powershell
npx wrangler@4 dev --local --var ALLOWED_ORIGIN:http://127.0.0.1:8001
```

Serve the frontend at `http://127.0.0.1:8001` and set its proxy URL to `http://127.0.0.1:8787`. No production Worker deployment is performed by this command.

## Nutrition source

Food search uses the official USDA FoodData Central API. USDA says its data is public domain (CC0), asks apps to cite FoodData Central, and requires a free data.gov API key. For GitHub Pages, the key must stay server-side: deploy the included Cloudflare Worker proxy and set its `USDA_API_KEY` secret, then enter only the Worker URL in Kitchen Ledger Settings. The browser never receives or stores the USDA key. USDA documents a default limit of 1,000 requests per hour per IP. Without a configured proxy, pantry and log features remain usable with manual nutrition entry from a package label or another source you trust.

For local development, copy `.dev.vars.example` to `.dev.vars`, replace the placeholder with a newly rotated USDA key, and run `npx wrangler@4 dev --var ALLOWED_ORIGIN:http://127.0.0.1:8001`. Serve the app on port 8001 and enter `http://127.0.0.1:8787` as the proxy URL in Settings. `.dev.vars` is gitignored. Do not put keys in `app.js`, GitHub Pages build variables, backups, or committed files. To deploy from GitHub Actions, add `USDA_API_KEY`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` as repository Actions secrets, then run the manual `Deploy USDA proxy` workflow. Use a newly rotated key; do not reuse any key pasted into chat. Only the Worker receives the USDA key; Pages only needs the public Worker URL in Settings.

For `karishmagarikapalli/recipe-app`, add secrets under **Settings → Secrets and variables → Actions → New repository secret**. Set `USDA_API_KEY` to the newly rotated USDA key, `CLOUDFLARE_API_TOKEN` to a Cloudflare token authorized to deploy Workers, and `CLOUDFLARE_ACCOUNT_ID` to the account identifier. The deploy workflow uploads the USDA key to Worker secret storage and does not print it. Do not create a `VITE_*`/Pages build variable for the USDA key; frontend build-time variables are public.

Because a public Worker URL can still be called outside the browser (CORS is not authentication), add a Cloudflare free-plan rate-limiting rule for path `/fdc/v1/foods/search`, counted by client IP, before using it broadly. The Worker also restricts its origin, method, path, body size, page size, and USDA data types. The USDA key itself is not a user login credential, but rate limiting helps protect its quota.

The app records the source and serving basis for each food. Nutrient totals are estimates from those entered/imported values; they are not medical advice. Set personal targets only from a source or professional you trust. Supplement data should be copied from the product label.

## Tests

From this folder, use Node.js 18 or newer; no dependency installation is needed:

```powershell
node --test app.test.cjs
node --test app.test.cjs worker/worker.test.mjs
node --check app.js
```

The app tests load the actual classic script in a `node:vm` harness and exercise its submit listener, nutrient totals, USDA selection, and backup export/import. DOM, timers, downloads, and storage are fake; app-test network access is disabled. Tests cover fractional and multiple portions/servings, optional pantry deduction with a zero-stock floor, USDA's per-100-g basis independent of the package serving, malformed backup rejection, a populated backup round trip, and failed import storage writes. They never access existing browser records or require USDA credentials.

Import accepts version-1 backup envelopes and legacy raw state objects. Foods and logs are required arrays; omitted supplements, supplement logs, cookbooks, targets, and proxy configuration receive empty defaults. Present records must have valid shapes, all six nutrient values must be finite nonnegative numbers, and food serving bases and logged portions/servings must be positive. Unsupported versions and malformed records are rejected before storage or state changes. Unknown top-level fields are discarded. A failed storage write leaves the previous state intact.

## Features

- Pantry inventory with quantities and USDA search
- Daily food and supplement logs, nutrient totals, and optional user-entered targets
- Supplement catalog with serving-level label values
- Cookbook shelf with recipe notes, ingredients, instructions, and source links
- JSON export/import for moving or backing up this browser's data

Data is local to this browser profile. It does not automatically sync between devices; use Settings to export and import a backup.