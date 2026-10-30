# Kitchen Ledger

A local-first, single-user kitchen inventory and nutrition journal. Pantry items, food logs, supplements, cookbooks, recipes, and goals are stored in this browser using `localStorage`; no account or hosted database is required. USDA search optionally uses a small server-side Cloudflare Worker proxy so the data.gov key is not exposed in the public static site.

## Run

Open `index.html` in a browser, or serve this folder locally:

```powershell
cd recipe-app
py -m http.server 8000
```

Then visit http://localhost:8000.

## Nutrition source

Food search uses the official USDA FoodData Central API. USDA says its data is public domain (CC0), asks apps to cite FoodData Central, and requires a free data.gov API key. For GitHub Pages, the key must stay server-side: deploy the included Cloudflare Worker proxy and set its `USDA_API_KEY` secret, then enter only the Worker URL in Kitchen Ledger Settings. The browser never receives or stores the USDA key. USDA documents a default limit of 1,000 requests per hour per IP. Without a configured proxy, pantry and log features remain usable with manual nutrition entry from a package label or another source you trust.

For local development, copy `.dev.vars.example` to `.dev.vars`, replace the placeholder with a newly rotated USDA key, and run `npx wrangler@4 dev --var ALLOWED_ORIGIN:http://127.0.0.1:8001`. Serve the app on port 8001 and enter `http://127.0.0.1:8787` as the proxy URL in Settings. `.dev.vars` is gitignored. Do not put keys in `app.js`, GitHub Pages build variables, backups, or committed files. To deploy from GitHub Actions, add `USDA_API_KEY`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` as repository Actions secrets, then run the manual `Deploy USDA proxy` workflow. Use a newly rotated key; do not reuse any key pasted into chat. Only the Worker receives the USDA key; Pages only needs the public Worker URL in Settings.

For `karishmagarikapalli/recipe-app`, add secrets under **Settings → Secrets and variables → Actions → New repository secret**. Set `USDA_API_KEY` to the newly rotated USDA key, `CLOUDFLARE_API_TOKEN` to a Cloudflare token authorized to deploy Workers, and `CLOUDFLARE_ACCOUNT_ID` to the account identifier. The deploy workflow uploads the USDA key to Worker secret storage and does not print it. Do not create a `VITE_*`/Pages build variable for the USDA key; frontend build-time variables are public.

Because a public Worker URL can still be called outside the browser (CORS is not authentication), add a Cloudflare free-plan rate-limiting rule for path `/fdc/v1/foods/search`, counted by client IP, before using it broadly. The Worker also restricts its origin, method, path, body size, page size, and USDA data types. The USDA key itself is not a user login credential, but rate limiting helps protect its quota.

Run offline proxy tests with `node --test worker/worker.test.mjs` and syntax-check the UI with `node --check app.js`.

The app records the source and serving basis for each food. Nutrient totals are estimates from those entered/imported values; they are not medical advice. Set personal targets only from a source or professional you trust. Supplement data should be copied from the product label.

## Features

- Pantry inventory with quantities and USDA search
- Daily food and supplement logs, nutrient totals, and optional user-entered targets
- Supplement catalog with serving-level label values
- Cookbook shelf with recipe notes, ingredients, instructions, and source links
- JSON export/import for moving or backing up this browser's data

Data is local to this browser profile. It does not automatically sync between devices; use Settings to export and import a backup.