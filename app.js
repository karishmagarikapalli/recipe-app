const STORAGE_KEY = 'kitchen-ledger-v1';
const FDC_PROXY_PATH = '/fdc/v1';
const NUTRIENTS = [
  ['calories', 'Calories', 'kcal', '208'],
  ['protein', 'Protein', 'g', '203'],
  ['carbs', 'Carbohydrates', 'g', '205'],
  ['fat', 'Fat', 'g', '204'],
  ['fiber', 'Fiber', 'g', '291'],
  ['sodium', 'Sodium', 'mg', '307'],
];
const emptyState = () => ({ foods: [], logs: [], supplements: [], supplementLogs: [], books: [], targets: {}, fdcProxyUrl: '' });
let state = readState();
let activeTab = 'overview';
let fdcResults = [];
let toastTimer;

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const { fdcKey: _legacyKey, ...safeSaved } = saved;
    if ('fdcKey' in saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(safeSaved));
    return { ...emptyState(), ...safeSaved, fdcProxyUrl: safeSaved.fdcProxyUrl || '' };
  } catch {
    return emptyState();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function sourceLink(value, label) {
  const href = safeUrl(value);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fmt(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function dateLabel(dateValue) {
  return new Date(`${dateValue}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function nutrientValues(nutrients) {
  return Object.fromEntries(NUTRIENTS.map(([key]) => [key, Number(nutrients?.[key] || 0)]));
}

function combineLogs(date) {
  return [
    ...state.logs.filter((log) => log.date === date).map((log) => ({ ...log, kind: 'food' })),
    ...state.supplementLogs.filter((log) => log.date === date).map((log) => ({ ...log, kind: 'supplement' })),
  ].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

function totalsFor(date) {
  const totals = nutrientValues();
  for (const log of combineLogs(date)) {
    for (const [key] of NUTRIENTS) totals[key] += Number(log.nutrients?.[key] || 0);
  }
  return totals;
}

function nutrientPanel(totals, targets = state.targets) {
  const mainNutrients = NUTRIENTS;
  return `<div class="nutrient-list">${mainNutrients.map(([key, label, unit]) => {
    const goal = Number(targets[key] || 0);
    const amount = totals[key] || 0;
    const width = goal > 0 ? Math.min(100, amount / goal * 100) : 0;
    const comparison = goal > 0 ? (amount < goal ? `${fmt(goal - amount, 1)} ${unit} to target` : `${fmt(amount - goal, 1)} ${unit} over`) : '';
    return `<div class="nutrient-row">
      <span class="nutrient-name">${label}</span>
      <div class="meter" aria-label="${esc(label)} ${fmt(amount, 1)}${unit}${goal ? ` of ${fmt(goal, 1)}${unit}` : ''}"><div class="meter-fill ${goal && amount > goal ? 'over' : ''}" style="width:${width}%"></div></div>
      <span class="nutrient-value">${fmt(amount, 1)}${unit}${goal ? `<span class="source-badge">${esc(comparison)}</span>` : ''}</span>
    </div>`;
  }).join('')}</div>`;
}

function pageHead(eyebrow, title, copy, button = '') {
  return `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="subhead">${esc(copy)}</p></div>${button}</div>`;
}

function renderOverview() {
  const date = today();
  const totals = totalsFor(date);
  const logs = combineLogs(date);
  const lowStock = state.foods.filter((food) => Number(food.quantity) <= 1).length;
  return `${pageHead('Kitchen, in view', 'A little more in tune.', dateLabel(date), '<button class="button" data-action="open-food">Add pantry food</button>')}
    <div class="grid overview-grid">
      <section class="panel panel-pad">
        <div class="panel-head"><div><h2>Today at a glance</h2><p class="subhead">Food and supplements you have logged</p></div><button class="button secondary small" data-tab="journal">Open daily log</button></div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-label">Energy logged</div><div class="stat-value">${fmt(totals.calories)}<span class="stat-unit">kcal</span></div></div>
          <div class="stat"><div class="stat-label">Protein</div><div class="stat-value">${fmt(totals.protein, 1)}<span class="stat-unit">g</span></div></div>
          <div class="stat"><div class="stat-label">Items in pantry</div><div class="stat-value">${state.foods.length}<span class="stat-unit">foods</span></div></div>
        </div>
        <div class="quick-actions">
          <button class="button secondary" data-action="open-log">Log food</button>
          <button class="button secondary" data-tab="supplements">Log a supplement</button>
          <button class="button secondary" data-tab="cookbooks">Browse cookbooks</button>
        </div>
      </section>
      <section class="panel panel-pad">
        <div class="panel-head"><div><h2>Nutrient check-in</h2><p class="subhead">Compared with targets you set</p></div><button class="button secondary small" data-tab="settings">Set goals</button></div>
        ${NUTRIENTS.some(([key]) => Number(state.targets[key]) > 0) ? nutrientPanel(totals) : '<div class="empty-state"><strong>No goals set</strong>Set personal targets in Settings to see progress here.</div>'}
      </section>
      <section class="panel panel-pad">
        <div class="panel-head"><div><h2>Latest entries</h2><p class="subhead">Today</p></div><button class="button secondary small" data-tab="journal">View log</button></div>
        ${logs.length ? `<div class="log-list">${logs.slice(-4).reverse().map(logRow).join('')}</div>` : '<div class="empty-state"><strong>Your day starts here</strong>Log a meal or supplement to see a running summary.</div>'}
      </section>
      <section class="panel panel-pad">
        <div class="panel-head"><div><h2>Pantry pulse</h2><p class="subhead">Items at one serving or less</p></div><span class="tag ${lowStock ? 'coral' : ''}">${lowStock} low</span></div>
        ${state.foods.length ? `<div class="log-list">${state.foods.slice(0, 4).map(food => `<div class="copy-row"><div><strong>${esc(food.name)}</strong><div class="source-badge">${esc(food.category || 'Food')}</div></div><span class="tag ${Number(food.quantity) <= 1 ? 'coral' : ''}">${fmt(food.quantity, 1)} ${esc(food.unit || 'g')}</span></div>`).join('')}</div>` : '<div class="empty-state"><strong>Pantry is clear</strong>Add foods you keep at home to build your inventory.</div>'}
      </section>
    </div>`;
}

function renderPantry() {
  const query = document.querySelector('#pantry-search')?.value?.trim().toLowerCase() || '';
  const foods = state.foods.filter(food => `${food.name} ${food.category || ''}`.toLowerCase().includes(query));
  return `${pageHead('What is on hand', 'Pantry', 'Keep quantities and trusted nutrition facts together.', '<button class="button" data-action="open-food">Add food</button>')}
    <section class="panel panel-pad">
      <div class="toolbar" style="margin-bottom:20px"><input class="input search-input" id="pantry-search" type="search" placeholder="Filter your pantry" value="${esc(document.querySelector('#pantry-search')?.value || '')}"><span class="tag">${foods.length} items</span></div>
      ${foods.length ? `<div class="table-wrap"><table><thead><tr><th>Food</th><th>On hand</th><th>Serving basis</th><th>Energy</th><th>Source</th><th></th></tr></thead><tbody>${foods.map(food => `<tr>
        <td><strong>${esc(food.name)}</strong>${food.category ? `<span class="source-badge">${esc(food.category)}</span>` : ''}</td>
        <td>${fmt(food.quantity, 1)} ${esc(food.unit || 'g')}</td><td>${fmt(food.servingGrams, 1)} g</td><td>${fmt(food.nutrients?.calories, 1)} kcal</td>
        <td>${sourceLink(food.sourceUrl, food.source || 'Source') || esc(food.source || 'Manual')}</td>
        <td><button class="icon-button" data-action="delete-food" data-id="${esc(food.id)}" aria-label="Remove ${esc(food.name)}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No pantry items yet</strong>Add a food and record its current quantity.</div>'}
    </section>
    <p class="source-line" style="margin:14px 2px">Imported USDA values retain their FoodData Central source ID. Manually entered values should be checked against the package or source you record.</p>`;
}

function logRow(log) {
  const unit = log.kind === 'supplement' ? `${fmt(log.doses || 1, 1)} serving${Number(log.doses || 1) === 1 ? '' : 's'}` : `${fmt(log.grams || 0, 1)} g`;
  return `<div class="log-item"><span class="log-time">${esc(log.time || '')}</span><div><strong>${esc(log.name)}</strong><small>${esc(log.meal || 'Supplement')} · ${unit}</small></div><span class="log-kcal">${fmt(log.nutrients?.calories, 1)} kcal</span></div>`;
}

function renderJournal() {
  const previousDate = document.querySelector('#journal-date')?.value;
  const selectedDate = previousDate || today();
  const totals = totalsFor(selectedDate);
  const logs = combineLogs(selectedDate);
  const options = state.foods.map(food => `<option value="${esc(food.id)}">${esc(food.name)}</option>`).join('');
  const supplementOptions = state.supplements.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  return `${pageHead('Daily record', 'Daily log', 'Record what you ate and review totals against your own targets.')}
    <div class="journal-layout">
      <section class="panel panel-pad">
        <div class="panel-head"><div><h2>Food and supplements</h2><p class="subhead">Entries are saved on this browser</p></div><input class="input date-control" id="journal-date" type="date" value="${esc(selectedDate)}" aria-label="Log date"></div>
        ${logs.length ? `<div class="log-list">${logs.slice().reverse().map(logRow).join('')}</div>` : '<div class="empty-state"><strong>No entries for this day</strong>Use the forms to record meals or supplement servings.</div>'}
        <hr class="subtle-rule" style="margin:20px 0">
        <div class="panel-head"><div><h2>Log food</h2><p class="subhead">Nutrients scale to the portion entered</p></div></div>
        ${state.foods.length ? `<form id="food-log-form" class="field-grid">
          <div class="field span-2"><label for="log-food">Pantry food</label><select class="select" id="log-food" name="foodId" required><option value="">Choose food</option>${options}</select></div>
          <div class="field"><label for="log-meal">Meal</label><select class="select" id="log-meal" name="meal"><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select></div>
          <div class="field"><label for="log-grams">Amount (grams)</label><input class="input" id="log-grams" name="grams" type="number" min="0.1" step="0.1" value="100" required></div>
          <label class="inline-check span-2"><input name="deductPantry" type="checkbox"> Subtract this amount from pantry stock</label>
          <div class="span-2"><button class="button" type="submit">Add food entry</button></div>
        </form>` : '<div class="notice">Add pantry foods first; then they appear here for logging.</div>'}
        <hr class="subtle-rule" style="margin:22px 0">
        <div class="panel-head"><div><h2>Log supplement</h2><p class="subhead">Use serving information from its label</p></div></div>
        ${state.supplements.length ? `<form id="supplement-log-form" class="field-grid">
          <div class="field span-2"><label for="log-supplement">Supplement</label><select class="select" id="log-supplement" name="supplementId" required><option value="">Choose supplement</option>${supplementOptions}</select></div>
          <div class="field"><label for="log-doses">Servings</label><input class="input" id="log-doses" name="doses" type="number" min="0.1" step="0.1" value="1" required></div>
          <div class="field"><label for="supplement-time">Time</label><input class="input" id="supplement-time" name="time" type="time" value="${new Date().toTimeString().slice(0, 5)}"></div>
          <div class="span-2"><button class="button secondary" type="submit">Add supplement entry</button></div>
        </form>` : '<div class="notice">Add supplements and their label values in the Supplements section to log them here.</div>'}
      </section>
      <aside class="panel panel-pad"><div class="panel-head"><div><h2>Nutrient totals</h2><p class="subhead">${esc(dateLabel(selectedDate))}</p></div></div>${nutrientPanel(totals)}<p class="source-line" style="margin:18px 0 0">Totals depend on the serving basis and values saved with each item. They are estimates, not medical guidance.</p></aside>
    </div>`;
}

function renderSupplements() {
  const items = state.supplements;
  return `${pageHead('Label-based tracking', 'Supplements', 'Keep product details and serving-level label facts in one place.', '<button class="button coral" data-action="open-supplement">Add supplement</button>')}
    <div class="notice" style="margin-bottom:18px">Supplement details are user-entered from product labels. This log does not recommend products, dosages, or combinations.</div>
    <section class="panel panel-pad"><div class="panel-head"><div><h2>Your supplement list</h2><p class="subhead">Nutrient values are per serving as entered</p></div><span class="tag">${items.length} saved</span></div>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Serving</th><th>Energy</th><th>Protein</th><th>Source</th><th></th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(item.name)}</strong>${item.brand ? `<span class="source-badge">${esc(item.brand)}</span>` : ''}</td><td>${esc(item.serving || '1 serving')}</td><td>${fmt(item.nutrients?.calories, 1)} kcal</td><td>${fmt(item.nutrients?.protein, 1)} g</td><td>${sourceLink(item.sourceUrl, 'Label/source') || esc(item.source || 'Product label')}</td><td><button class="icon-button" data-action="delete-supplement" data-id="${esc(item.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No supplements saved</strong>Add a product only when you have its serving and label details.</div>'}
    </section>`;
}

function renderCookbooks() {
  const books = state.books;
  return `${pageHead('Your recipe shelf', 'Cookbooks', 'Save the books, links, and recipes you return to.', '<button class="button" data-action="open-book">Add cookbook</button>')}
    ${books.length ? `<div class="book-grid">${books.map(book => `<article class="book-card"><div class="book-spine" aria-hidden="true"></div><h3>${esc(book.title)}</h3><p>${esc(book.author || 'Author not listed')}${book.notes ? ` · ${esc(book.notes)}` : ''}</p>${sourceLink(book.url, 'Open source') ? `<p>${sourceLink(book.url, 'Open source')}</p>` : ''}<div class="copy-row"><span class="tag blue">${book.recipes.length} recipes</span><button class="button secondary small" data-action="open-recipe" data-id="${esc(book.id)}">Add recipe</button></div>${book.recipes.length ? `<div class="recipe-list">${book.recipes.map(recipe => `<article class="recipe-card"><details><summary>${esc(recipe.title)}</summary>${sourceLink(recipe.url, 'Recipe source') ? `<p>${sourceLink(recipe.url, 'Recipe source')}</p>` : ''}${recipe.ingredients ? `<p><strong>Ingredients</strong><br>${esc(recipe.ingredients)}</p>` : ''}${recipe.instructions ? `<p><strong>Notes / method</strong><br>${esc(recipe.instructions)}</p>` : ''}</details></article>`).join('')}</div>` : ''}</article>`).join('')}</div>` : '<section class="panel panel-pad"><div class="empty-state"><strong>Your shelf is waiting</strong>Add a cookbook, then save recipes and notes under it.</div></section>'}`;
}

function renderSettings() {
  const targets = state.targets;
  return `${pageHead('Local preferences', 'Settings', 'Manage your nutrition source, personal targets, and local data backup.')}
    <div class="grid split-grid">
      <section class="panel panel-pad"><div class="panel-head"><div><h2>USDA FoodData Central</h2><p class="subhead">Official data search · free key required</p></div><span class="tag">CC0 data</span></div>
        <p class="subhead" style="margin-bottom:16px">USDA data is public domain. Search uses a server-side proxy so its API key is never stored in this browser. Manual pantry entry remains available without the proxy.</p>
        <form id="settings-form" class="field-grid">
          <div class="field span-2"><label for="fdc-proxy-url">USDA proxy URL</label><input class="input" id="fdc-proxy-url" name="fdcProxyUrl" type="url" autocomplete="url" value="${esc(state.fdcProxyUrl)}" placeholder="https://your-worker.workers.dev"></div>
          <div class="span-2"><a href="https://fdc.nal.usda.gov/api-key-signup#top" target="_blank" rel="noopener noreferrer">Get a free USDA API key</a></div>
          <hr class="subtle-rule span-2">
          <div class="span-2"><h3>Daily targets you choose</h3><p class="source-line">Leave a field empty to track totals without a goal. This app does not set recommended targets.</p></div>
          ${NUTRIENTS.map(([key, label, unit]) => `<div class="field"><label for="target-${key}">${label} (${unit})</label><input class="input" id="target-${key}" name="target-${key}" type="number" min="0" step="any" value="${targets[key] ? esc(targets[key]) : ''}" placeholder="No target"></div>`).join('')}
          <div class="span-2"><button class="button" type="submit">Save settings</button></div>
        </form>
      </section>
      <section class="panel panel-pad"><div class="panel-head"><div><h2>Backup and restore</h2><p class="subhead">Move your data between browser profiles</p></div></div>
        <div class="notice" style="margin-bottom:16px">Your records stay in this browser. Export a backup before clearing site data or changing devices. Export files include your USDA key and personal logs; keep them private.</div>
        <div class="grid"><button class="button secondary" data-action="export-data">Export all data</button><label class="button secondary" for="import-file">Import backup JSON</label><input id="import-file" type="file" accept="application/json,.json" hidden><button class="button secondary" data-action="clear-data">Clear local data</button></div>
      </section>
    </div>
    <p class="source-line" style="margin-top:18px">Nutrition source: <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener noreferrer">USDA FoodData Central</a> (public domain, CC0). USDA lists a default API limit of 1,000 requests per hour per IP. The app searches only when you ask it to.</p>`;
}

function render() {
  const renderers = { overview: renderOverview, pantry: renderPantry, journal: renderJournal, supplements: renderSupplements, cookbooks: renderCookbooks, settings: renderSettings };
  document.querySelector('#app').innerHTML = (renderers[activeTab] || renderOverview)();
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.tab === activeTab));
}

function openModal(title, copy, content) {
  const dialog = document.querySelector('#modal');
  dialog.innerHTML = `<div class="modal-head"><div><h2>${esc(title)}</h2><p class="subhead">${esc(copy)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">Close</button></div><div class="modal-body">${content}</div>`;
  dialog.showModal();
}

function foodForm() {
  const fields = NUTRIENTS.map(([key, label, unit]) => `<div class="field"><label for="food-${key}">${label} (${unit}) per serving</label><input class="input" id="food-${key}" name="${key}" type="number" min="0" step="any" value="0"></div>`).join('');
  return `<form id="food-form" class="modal-body">
    <section><div class="field"><label for="usda-query">Search USDA foods</label><div class="toolbar"><input class="input search-input" id="usda-query" type="search" placeholder="e.g. rolled oats"><button class="button secondary" type="button" data-action="search-usda">Search USDA</button></div></div><div id="usda-results" class="search-results" aria-live="polite"></div><p class="source-line">${state.fdcProxyUrl ? 'Private USDA proxy configured.' : 'No USDA proxy configured; manual nutrition entry is available.'}</p></section>
    <hr class="subtle-rule">
    <div class="field-grid">
      <div class="field span-2"><label for="food-name">Food name</label><input class="input" id="food-name" name="name" required maxlength="120" placeholder="Name this pantry item"></div>
      <div class="field"><label for="food-category">Category</label><select class="select" id="food-category" name="category"><option>Produce</option><option>Grains</option><option>Dairy</option><option>Protein</option><option>Pantry</option><option>Frozen</option><option>Other</option></select></div>
      <div class="field"><label for="food-quantity">On hand (grams)</label><input class="input" id="food-quantity" name="quantity" type="number" min="0" step="any" value="0" required></div>
      <div class="field"><label for="food-serving">Nutrition basis (grams)</label><input class="input" id="food-serving" name="servingGrams" type="number" min="0.1" step="any" value="100" required></div>
      <div class="field"><label for="food-source">Source label</label><input class="input" id="food-source" name="source" value="Manual entry" maxlength="80"></div>
      <div class="field span-2"><label for="food-source-url">Source link or FDC page (optional)</label><input class="input" id="food-source-url" name="sourceUrl" type="url" placeholder="https://..."></div>
      <div class="span-2"><p class="source-line">Enter nutrition amounts for the serving basis above. USDA search values are per 100 g; the package serving size shown in results is separate.</p></div>
      ${fields}
      <input type="hidden" name="fdcId" value="">
      <div class="modal-actions span-2"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save pantry item</button></div>
    </div>
  </form>`;
}

function supplementForm() {
  return `<form id="supplement-form" class="modal-body"><div class="field-grid">
    <div class="field"><label for="supp-name">Product name</label><input class="input" id="supp-name" name="name" required maxlength="120"></div>
    <div class="field"><label for="supp-brand">Brand</label><input class="input" id="supp-brand" name="brand" maxlength="100"></div>
    <div class="field"><label for="supp-serving">Label serving</label><input class="input" id="supp-serving" name="serving" placeholder="e.g. 1 capsule, 5 g" required></div>
    <div class="field"><label for="supp-source">Source</label><input class="input" id="supp-source" name="source" value="Product label"></div>
    <div class="field span-2"><label for="supp-url">Product/label source URL</label><input class="input" id="supp-url" name="sourceUrl" type="url"></div>
    ${NUTRIENTS.map(([key, label, unit]) => `<div class="field"><label for="supp-${key}">${label} (${unit}) per serving</label><input class="input" id="supp-${key}" name="${key}" type="number" min="0" step="any" value="0"></div>`).join('')}
    <div class="modal-actions span-2"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button coral" type="submit">Save supplement</button></div>
  </div></form>`;
}

function bookForm() {
  return `<form id="book-form" class="modal-body"><div class="field-grid"><div class="field span-2"><label for="book-title">Cookbook title</label><input class="input" id="book-title" name="title" required maxlength="160"></div><div class="field"><label for="book-author">Author</label><input class="input" id="book-author" name="author" maxlength="120"></div><div class="field"><label for="book-url">Publisher or book link</label><input class="input" id="book-url" name="url" type="url"></div><div class="field span-2"><label for="book-notes">Notes</label><textarea class="textarea" id="book-notes" name="notes" maxlength="1000"></textarea></div><div class="modal-actions span-2"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save cookbook</button></div></div></form>`;
}

function recipeForm(bookId) {
  const book = state.books.find(item => item.id === bookId);
  return `<form id="recipe-form" class="modal-body" data-book-id="${esc(bookId)}"><p class="tag blue">${esc(book?.title || '')}</p><div class="field"><label for="recipe-title">Recipe name</label><input class="input" id="recipe-title" name="title" required maxlength="160"></div><div class="field"><label for="recipe-url">Recipe source URL (optional)</label><input class="input" id="recipe-url" name="url" type="url"></div><div class="field"><label for="recipe-ingredients">Ingredients</label><textarea class="textarea" id="recipe-ingredients" name="ingredients" placeholder="One ingredient per line"></textarea></div><div class="field"><label for="recipe-instructions">Instructions or notes</label><textarea class="textarea" id="recipe-instructions" name="instructions"></textarea></div><div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save recipe</button></div></form>`;
}

async function searchUSDA() {
  const query = document.querySelector('#usda-query').value.trim();
  const results = document.querySelector('#usda-results');
  if (!query) { results.innerHTML = '<p class="source-line">Enter a food to search.</p>'; return; }
  const proxyUrl = safeUrl(state.fdcProxyUrl).replace(/\/$/, '');
  let parsedProxy;
  try { parsedProxy = new URL(proxyUrl); } catch { parsedProxy = null; }
  const localProxy = parsedProxy && ['localhost', '127.0.0.1', '[::1]'].includes(parsedProxy.hostname);
  if (!parsedProxy || (parsedProxy.protocol !== 'https:' && !(localProxy && parsedProxy.protocol === 'http:'))) { results.innerHTML = '<div class="notice">Set an HTTPS USDA proxy URL in Settings (HTTP is allowed for localhost development only). Manual nutrition entry is always available.</div>'; return; }
  const proxyBase = parsedProxy.href.replace(/\/$/, '');
  results.innerHTML = '<p class="source-line">Searching FoodData Central…</p>';
  try {
    const url = `${proxyBase}${FDC_PROXY_PATH}/foods/search`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, pageSize: 8, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] }) });
    if (!response.ok) throw new Error(response.status === 403 ? 'USDA rejected this key or rate limit.' : `USDA search returned ${response.status}.`);
    const data = await response.json();
    fdcResults = data.foods || [];
    results.innerHTML = fdcResults.length ? fdcResults.map((food, index) => `<button class="result-button" type="button" data-action="select-usda" data-index="${index}"><strong>${esc(food.description)}</strong><small>${esc(food.dataType || 'USDA')} · FDC ${food.fdcId} · ${food.servingSize ? `label serving ${fmt(food.servingSize, 1)} ${esc(food.servingSizeUnit || '')} · nutrients per 100 g` : 'nutrients per 100 g'}</small></button>`).join('') : '<p class="source-line">No matches. Try a shorter search phrase.</p>';
  } catch (error) {
    results.innerHTML = `<p class="warning-text">${esc(error.message || 'Could not reach USDA.')}</p>`;
  }
}

function selectUSDAFood(index) {
  const food = fdcResults[index];
  if (!food) return;
  const servingGrams = 100;
  const values = nutrientValues();
  const names = { '208': 'calories', '203': 'protein', '205': 'carbs', '204': 'fat', '291': 'fiber', '307': 'sodium' };
  for (const nutrient of food.foodNutrients || []) {
    const key = names[String(nutrient.nutrientNumber || nutrient.nutrient?.number || '')];
    if (key) values[key] = Number(nutrient.value ?? nutrient.amount ?? 0);
  }
  document.querySelector('#food-name').value = food.description || '';
  document.querySelector('#food-serving').value = servingGrams;
  document.querySelector('#food-source').value = `USDA ${food.dataType || 'FoodData Central'} (per 100 g)`;
  document.querySelector('#food-source-url').value = `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`;
  document.querySelector('[name="fdcId"]').value = food.fdcId;
  for (const [key] of NUTRIENTS) document.querySelector(`#food-${key}`).value = values[key];
  showToast(`Selected USDA record ${food.fdcId}; confirm its serving basis.`);
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function asNutrients(data) {
  return Object.fromEntries(NUTRIENTS.map(([key]) => [key, Math.max(0, Number(data[key] || 0))]));
}

function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const data = formValues(form);
  if (form.id === 'food-form') {
    state.foods.push({ id: uid(), name: data.name.trim(), category: data.category, quantity: Math.max(0, Number(data.quantity)), unit: 'g', servingGrams: Math.max(.1, Number(data.servingGrams)), nutrients: asNutrients(data), source: data.source.trim(), sourceUrl: data.sourceUrl.trim(), fdcId: data.fdcId });
    showToast('Food added to your pantry.');
    closeModal();
  } else if (form.id === 'food-log-form') {
    const food = state.foods.find(item => item.id === data.foodId);
    if (!food) return;
    const grams = Math.max(.1, Number(data.grams));
    const multiplier = grams / Math.max(.1, Number(food.servingGrams));
    const now = new Date();
    state.logs.push({ id: uid(), foodId: food.id, name: food.name, date: document.querySelector('#journal-date')?.value || today(), time: now.toTimeString().slice(0, 5), meal: data.meal, grams, nutrients: Object.fromEntries(NUTRIENTS.map(([key]) => [key, food.nutrients[key] * multiplier])) });
    if (form.elements.deductPantry.checked) food.quantity = Math.max(0, Number(food.quantity) - grams);
    showToast('Food entry saved.');
  } else if (form.id === 'supplement-form') {
    state.supplements.push({ id: uid(), name: data.name.trim(), brand: data.brand.trim(), serving: data.serving.trim(), source: data.source.trim(), sourceUrl: data.sourceUrl.trim(), nutrients: asNutrients(data) });
    showToast('Supplement saved from label details.');
    closeModal();
  } else if (form.id === 'supplement-log-form') {
    const item = state.supplements.find(supplement => supplement.id === data.supplementId);
    if (!item) return;
    const doses = Math.max(.1, Number(data.doses));
    const now = new Date();
    state.supplementLogs.push({ id: uid(), supplementId: item.id, name: item.name, date: document.querySelector('#journal-date')?.value || today(), time: data.time || now.toTimeString().slice(0, 5), meal: 'Supplement', doses, nutrients: Object.fromEntries(NUTRIENTS.map(([key]) => [key, item.nutrients[key] * doses])) });
    showToast('Supplement entry saved.');
  } else if (form.id === 'book-form') {
    state.books.push({ id: uid(), title: data.title.trim(), author: data.author.trim(), url: data.url.trim(), notes: data.notes.trim(), recipes: [] });
    showToast('Cookbook added to your shelf.');
    closeModal();
  } else if (form.id === 'recipe-form') {
    const book = state.books.find(item => item.id === form.dataset.bookId);
    if (!book) return;
    book.recipes.push({ id: uid(), title: data.title.trim(), url: data.url.trim(), ingredients: data.ingredients.trim(), instructions: data.instructions.trim() });
    showToast('Recipe saved.');
    closeModal();
  } else if (form.id === 'settings-form') {
    const proxyInput = data.fdcProxyUrl.trim();
    if (proxyInput) {
      const proxyUrl = new URL(proxyInput);
      const localProxy = ['localhost', '127.0.0.1', '[::1]'].includes(proxyUrl.hostname);
      if ((proxyUrl.protocol !== 'https:' && !(localProxy && proxyUrl.protocol === 'http:')) || proxyUrl.username || proxyUrl.password || proxyUrl.search || proxyUrl.hash || proxyUrl.pathname !== '/') {
        showToast('USDA proxy URL must be an HTTPS origin (HTTP is allowed for localhost development).');
        return;
      }
      state.fdcProxyUrl = proxyUrl.href.replace(/\/$/, '');
    } else {
      state.fdcProxyUrl = '';
    }
    state.targets = Object.fromEntries(NUTRIENTS.map(([key]) => [key, Number(data[`target-${key}`] || 0)]));
    showToast('Settings saved in this browser.');
  }
  persist();
  render();
}

function closeModal() {
  const dialog = document.querySelector('#modal');
  if (dialog.open) dialog.close();
  dialog.innerHTML = '';
}

function exportData() {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kitchen-ledger-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importData(file) {
  try {
    const backup = JSON.parse(await file.text());
    const imported = backup.state || backup;
    if (!Array.isArray(imported.foods) || !Array.isArray(imported.logs)) throw new Error('This file does not look like a Kitchen Ledger backup.');
    state = { ...emptyState(), ...imported };
    persist();
    render();
    showToast('Backup imported.');
  } catch (error) {
    showToast(error.message || 'Could not import that backup.');
  }
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    activeTab = tab.dataset.tab;
    render();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  switch (action.dataset.action) {
    case 'open-food': openModal('Add pantry food', 'Search USDA or enter trusted label values manually.', foodForm()); break;
    case 'open-log': activeTab = 'journal'; render(); break;
    case 'open-supplement': openModal('Add supplement', 'Use the product label for serving and nutrient values.', supplementForm()); break;
    case 'open-book': openModal('Add cookbook', 'Keep a shelf of books, links, and personal notes.', bookForm()); break;
    case 'open-recipe': openModal('Save a recipe', 'Store your notes and the original source.', recipeForm(action.dataset.id)); break;
    case 'search-usda': void searchUSDA(); break;
    case 'select-usda': selectUSDAFood(Number(action.dataset.index)); break;
    case 'delete-food': state.foods = state.foods.filter(food => food.id !== action.dataset.id); persist(); render(); showToast('Pantry item removed.'); break;
    case 'delete-supplement': state.supplements = state.supplements.filter(item => item.id !== action.dataset.id); persist(); render(); showToast('Supplement removed.'); break;
    case 'close-modal': closeModal(); break;
    case 'export-data': exportData(); break;
    case 'clear-data': if (confirm('Clear all Kitchen Ledger records from this browser? This cannot be undone. Export a backup first if you need one.')) { state = emptyState(); persist(); activeTab = 'overview'; render(); showToast('Local data cleared.'); } break;
  }
});

document.addEventListener('submit', event => {
  if (['food-form', 'food-log-form', 'supplement-form', 'supplement-log-form', 'book-form', 'recipe-form', 'settings-form'].includes(event.target.id)) {
    event.preventDefault();
    handleSubmit(event);
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'pantry-search') {
    const cursor = event.target.selectionStart;
    render();
    const input = document.querySelector('#pantry-search');
    input.focus();
    input.setSelectionRange(cursor, cursor);
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'journal-date') render();
  if (event.target.id === 'import-file' && event.target.files?.[0]) void importData(event.target.files[0]);
});

document.querySelector('#modal').addEventListener('click', event => {
  if (event.target === event.currentTarget) closeModal();
});

render();