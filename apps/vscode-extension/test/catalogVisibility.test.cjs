const assert = require('node:assert/strict');
const { test } = require('node:test');
const { visibleCatalogModels } = require('../dist/catalogVisibility');
const row = (id, status, kind = 'serverless') => ({
  id,
  label: id,
  status,
  kind,
});
test('retired catalog offers hidden; mixed lifecycle and unknown status retained', () => {
  const rows = [
    row('a', 'retired'),
    row('b', 'end_of_life'),
    row('c', 'EOL'),
    row('d', 'retired / end_of_life'),
    row('e', 'preview'),
    row('f', 'general_availability'),
    row('g', 'end_of_life / preview'),
    row('h', undefined),
    row('i', 'unknown'),
    row('retired-name', 'preview'),
  ];
  const snapshot = structuredClone(rows);
  assert.deepEqual(
    visibleCatalogModels(rows).map((r) => r.id),
    ['e', 'f', 'g', 'h', 'i', 'retired-name'],
  );
  assert.deepEqual(rows, snapshot);
});
test('dedicated catalog lifecycle checked without hiding existing deployments', () => {
  const rows = [
    row('a', 'Catalogue fournisseur · retired', 'dedicated-catalog'),
    row('b', 'Projet · end_of_life', 'dedicated-catalog'),
    row('c', 'Catalogue fournisseur · available', 'dedicated-catalog'),
    row('d', 'retired', 'dedicated'),
  ];
  assert.deepEqual(
    visibleCatalogModels(rows).map((r) => r.id),
    ['c', 'd'],
  );
});
