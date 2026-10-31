const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'app.js'), 'utf8');
const nutrients = { calories: 240, protein: 12, carbs: 30, fat: 8, fiber: 4, sodium: 160 };
const food = { id: 'food-1', name: 'Test oats', quantity: 200, unit: 'g', servingGrams: 80, nutrients };
const supplement = { id: 'supplement-1', name: 'Test label', nutrients };
const date = '2026-10-30';

function harness(saved = {}, { failWrites = false } = {}) {
  const storage = new Map([['kitchen-ledger-v1', JSON.stringify(saved)]]);
  const writes = [];
  const elements = new Map();
  const listeners = new Map();
  let exportedBlob;
  let download;
  let revoked;
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', innerHTML: '', textContent: '', open: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, close() { this.open = false; },
    });
    return elements.get(selector);
  }
  element('#journal-date').value = date;
  class FakeForm {
    constructor(id, values, deductPantry) {
      this.id = id;
      this.values = values;
      this.elements = { deductPantry: { checked: deductPantry } };
    }
  }
  const context = vm.createContext({
    document: {
      querySelector: element, querySelectorAll: () => [],
      addEventListener: (type, listener) => listeners.set(type, listener),
      createElement: () => ({ click() { download = this.download; } }),
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrites) throw new Error('Synthetic storage write failure');
        writes.push([key, value]);
        storage.set(key, value);
      },
    },
    HTMLFormElement: FakeForm,
    FormData: class { constructor(form) { this.entries = () => Object.entries(form.values); } },
    URL: class extends URL {
      static createObjectURL(blob) { exportedBlob = blob; return 'blob:test-backup'; }
      static revokeObjectURL(url) { revoked = url; }
    },
    Blob, setTimeout: () => 1, clearTimeout() {},
    fetch: () => { throw new Error('Network is disabled in app tests'); },
  });
  vm.runInContext(source, context, { filename: 'app.js' });
  return {
    element, writes, storage,
    state: () => JSON.parse(vm.runInContext('JSON.stringify(state)', context)),
    submit(id, values, deductPantry = false) {
      let prevented = false;
      listeners.get('submit')({ target: new FakeForm(id, values, deductPantry), preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    },
    async import(backup) {
      context.testFile = { text: async () => typeof backup === 'string' ? backup : JSON.stringify(backup) };
      await vm.runInContext('importData(testFile)', context);
    },
    async export() {
      vm.runInContext('exportData()', context);
      assert.match(download, /^kitchen-ledger-\d{4}-\d{2}-\d{2}\.json$/);
      assert.equal(revoked, 'blob:test-backup');
      return JSON.parse(await exportedBlob.text());
    },
    select(record) {
      context.testRecord = JSON.stringify(record);
      vm.runInContext('fdcResults = [JSON.parse(testRecord)]; selectUSDAFood(0)', context);
    },
    totals: () => JSON.parse(vm.runInContext(`JSON.stringify(totalsFor('${date}'))`, context)),
  };
}

function scaled(factor) {
  return Object.fromEntries(Object.entries(nutrients).map(([key, value]) => [key, value * factor]));
}

for (const grams of [20, 80, 120]) {
  test(`food portion ${grams} g scales all six nutrients from an 80 g basis`, () => {
    const app = harness({ foods: [food] });
    app.submit('food-log-form', { foodId: food.id, grams: String(grams), meal: 'Lunch' });
    const entry = app.state().logs[0];
    assert.equal(entry.grams, grams);
    assert.equal(entry.date, date);
    assert.deepEqual(entry.nutrients, scaled(grams / 80));
    assert.deepEqual(app.totals(), entry.nutrients);
    assert.equal(app.state().foods[0].quantity, 200);
    assert.deepEqual(JSON.parse(app.writes.at(-1)[1]), app.state());
  });
}

for (const [quantity, grams, expected] of [[200, 25.5, 174.5], [20, 20, 0], [20, 50, 0]]) {
  test(`pantry deduction ${quantity} - ${grams} clamps at ${expected} g`, () => {
    const app = harness({ foods: [{ ...food, quantity }] });
    app.submit('food-log-form', { foodId: food.id, grams: String(grams), meal: 'Lunch' }, true);
    assert.equal(app.state().foods[0].quantity, expected);
    assert.equal(app.state().logs[0].grams, grams);
    assert.deepEqual(app.state().logs[0].nutrients, scaled(grams / 80));
  });
}

for (const doses of [0.5, 1, 2.5]) {
  test(`supplement ${doses} servings scales label values independently of food`, () => {
    const app = harness({ foods: [food], supplements: [supplement] });
    app.submit('food-log-form', { foodId: food.id, grams: '40', meal: 'Breakfast' });
    app.submit('supplement-log-form', { supplementId: supplement.id, doses: String(doses), time: '09:15' });
    const entry = app.state().supplementLogs[0];
    assert.equal(entry.doses, doses);
    assert.equal(entry.time, '09:15');
    assert.equal(entry.date, date);
    assert.deepEqual(entry.nutrients, scaled(doses));
    assert.deepEqual(app.totals(), scaled(doses + 0.5));
    assert.equal(app.state().foods[0].quantity, 200);
  });
}

test('USDA branded label serving stays separate from per-100-g imported nutrients', () => {
  const app = harness();
  app.select({
    fdcId: 12345, description: 'Synthetic branded oats', dataType: 'Branded',
    servingSize: 30, servingSizeUnit: 'g',
    foodNutrients: [
      { nutrientNumber: '208', value: 240 }, { nutrient: { number: '203' }, amount: 12 },
      { nutrientNumber: '205', value: 30 }, { nutrientNumber: '204', value: 8 },
      { nutrientNumber: '291', value: 4 }, { nutrientNumber: '307', value: 160 },
      { nutrientNumber: '999', value: 999 },
    ],
  });
  assert.equal(Number(app.element('#food-serving').value), 100);
  assert.match(app.element('#food-source').value, /per 100 g/);
  assert.match(app.element('#food-source-url').value, /12345\/nutrients$/);
  const selected = Object.fromEntries(Object.keys(nutrients).map(key => [key, String(app.element(`#food-${key}`).value)]));
  app.submit('food-form', {
    ...selected, name: app.element('#food-name').value, category: 'Grains', quantity: '300',
    servingGrams: String(app.element('#food-serving').value), source: app.element('#food-source').value,
    sourceUrl: app.element('#food-source-url').value, fdcId: String(app.element('[name="fdcId"]').value),
  });
  const imported = app.state().foods[0];
  assert.deepEqual(imported.nutrients, nutrients);
  assert.equal(imported.fdcId, '12345');
  app.submit('food-log-form', { foodId: imported.id, grams: '30', meal: 'Breakfast' });
  assert.deepEqual(app.state().logs[0].nutrients, scaled(0.3));
});

test('backup accepts a version-1 envelope and legacy raw state with optional collections omitted', async () => {
  for (const backup of [{ version: 1, state: { foods: [food], logs: [] } }, { foods: [food], logs: [] }]) {
    const app = harness();
    await app.import(backup);
    assert.deepEqual(app.state().foods, [food]);
    assert.deepEqual(app.state().supplements, []);
    assert.deepEqual(app.state().supplementLogs, []);
    assert.deepEqual(app.state().books, []);
    assert.equal(app.element('#toast').textContent, 'Backup imported.');
    assert.equal(app.writes.length, 1);
  }
});

test('full backup round trip preserves logs, cookbooks, targets, and proxy configuration', async () => {
  const original = harness({
    foods: [food], supplements: [supplement],
    books: [{ id: 'book-1', title: 'Test cookbook', author: 'Test author', recipes: [
      { id: 'recipe-1', title: 'Test recipe', ingredients: 'Oats', instructions: 'Cook', url: '' },
    ] }],
    targets: { calories: 2000, protein: 100 }, fdcProxyUrl: 'https://proxy.example',
  });
  original.submit('food-log-form', { foodId: food.id, grams: '40', meal: 'Breakfast' });
  original.submit('supplement-log-form', { supplementId: supplement.id, doses: '0.5', time: '08:00' });
  const backup = await original.export();
  assert.equal(backup.version, 1);
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
  const restored = harness();
  await restored.import(backup);
  assert.equal(restored.element('#toast').textContent, 'Backup imported.');
  assert.deepEqual(restored.state(), original.state());
  assert.deepEqual(restored.totals(), original.totals());
});

test('backup ignores unknown top-level fields', async () => {
  const app = harness();
  await app.import({ foods: [], logs: [], unexpected: 'synthetic extra field' });
  assert.equal(Object.hasOwn(app.state(), 'unexpected'), false);
  assert.equal(Object.hasOwn(JSON.parse(app.writes[0][1]), 'unexpected'), false);
});

test('backup storage failure leaves the previous in-memory and stored state intact', async () => {
  const app = harness({ foods: [food] }, { failWrites: true });
  const before = app.state();
  const stored = app.storage.get('kitchen-ledger-v1');
  await app.import({ foods: [], logs: [] });
  assert.deepEqual(app.state(), before);
  assert.equal(app.storage.get('kitchen-ledger-v1'), stored);
  assert.equal(app.element('#toast').textContent, 'Synthetic storage write failure');
});

const invalidBackups = {
  'invalid JSON': '{',
  'null root': 'null',
  'missing required collection': { foods: [] },
  'unsupported version': { version: 2, state: { foods: [], logs: [] } },
  'null optional collection': { foods: [], logs: [], supplements: null },
  'non-array optional collection': { foods: [], logs: [], supplementLogs: {} },
  'null record': { foods: [null], logs: [] },
  'missing nutrient basis': { foods: [{ ...food, servingGrams: 0 }], logs: [] },
  'negative stock': { foods: [{ ...food, quantity: -1 }], logs: [] },
  'string nutrient': { foods: [{ ...food, nutrients: { ...nutrients, protein: '12' } }], logs: [] },
  'overflow nutrient': '{"foods":[],"logs":[],"targets":{"calories":1e400}}',
  'incomplete nutrients': { foods: [{ ...food, nutrients: {} }], logs: [] },
  'malformed log': { foods: [], logs: [{ id: 'log-1', name: 'Test', date, grams: -5, nutrients }] },
  'non-string log time': { foods: [], logs: [{ id: 'log-1', name: 'Test', date, time: {}, grams: 5, nutrients }] },
  'malformed supplement': { foods: [], logs: [], supplements: [{ ...supplement, nutrients: null }] },
  'malformed supplement log': { foods: [], logs: [], supplementLogs: [{ id: 'log-1', name: 'Test', date, doses: 0, nutrients }] },
  'malformed cookbook': { foods: [], logs: [], books: [{ id: 'book-1', title: 'Test', recipes: null }] },
  'malformed recipe': { foods: [], logs: [], books: [{ id: 'book-1', title: 'Test', recipes: [null] }] },
  'null targets': { foods: [], logs: [], targets: null },
  'non-string proxy': { foods: [], logs: [], fdcProxyUrl: {} },
};

for (const [label, backup] of Object.entries(invalidBackups)) {
  test(`backup rejects ${label} without mutating state or storage`, async () => {
    const app = harness({ foods: [food] });
    const before = app.state();
    const stored = app.storage.get('kitchen-ledger-v1');
    await app.import(backup);
    assert.deepEqual(app.state(), before);
    assert.equal(app.storage.get('kitchen-ledger-v1'), stored);
    assert.equal(app.writes.length, 0);
    assert.notEqual(app.element('#toast').textContent, 'Backup imported.');
    assert.ok(app.element('#toast').textContent);
  });
}