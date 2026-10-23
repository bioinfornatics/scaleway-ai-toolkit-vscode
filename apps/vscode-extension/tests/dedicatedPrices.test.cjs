const assert = require('node:assert/strict');
const { test } = require('node:test');
const { moneyEUR, listDedicatedPrices } = require('../dist/dedicatedPrices');
const row = () => ({
  sku: '/ai/inference_dedicated/deployment/h100-1/fr-par',
  product: 'H100',
  status: 'general_availability',
  locality: { region: 'fr-par' },
  unit_of_measure: { unit: 'node', size: 1 },
  price: { retail_price: { currency_code: 'EUR', units: 0, nanos: 56660000 } },
  properties: { managed_inference: { instance_gpu_name: 'H100-1-80G' } },
});
test('EUR nanos retain exact precision, zero and large safe values without hourly inference', () => {
  assert.equal(moneyEUR(row().price.retail_price), '0.05666');
  assert.equal(
    moneyEUR({ currency_code: 'EUR', units: 12, nanos: 1 }),
    '12.000000001',
  );
  assert.equal(moneyEUR({ currency_code: 'EUR', units: 0, nanos: 0 }), '0');
  for (const change of [
    { currency_code: 'USD' },
    { units: '1' },
    { units: -1 },
    { nanos: 1000000000 },
    { nanos: 0.5 },
    { nanos: null },
  ])
    assert.throws(
      () => moneyEUR({ ...row().price.retail_price, ...change }),
      /invalid_price_response/,
    );
});
test('fixed public dedicated price route sends no JWT and returns timestamped raw unit evidence', async () => {
  let sends = 0;
  const result = await listDedicatedPrices(
    new AbortController().signal,
    async (origin, path, key) => {
      sends++;
      assert.equal(origin, 'control');
      assert.equal(key, '');
      assert.equal(
        path,
        '/product-catalog/v2alpha1/public-catalog/products?product_types=managed_inference&region=fr-par&page=1&page_size=100',
      );
      return {
        products: [
          row(),
          {
            ...row(),
            sku: 'storage',
            product: 'Storage',
            unit_of_measure: { unit: 'gigabyte', size: 1 },
          },
        ],
        total_count: 2,
      };
    },
    new Date('2026-10-21T05:00:00Z'),
  );
  assert.equal(sends, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].amountEUR, '0.05666');
  assert.equal(result[0].period, 'unspecified-in-catalog');
  assert.equal(result[0].fetchedAt, '2026-10-21T05:00:00.000Z');
  assert.ok(!('hourlyPriceEUR' in result[0]));
});
test('price locality, units, duplicate names/SKU and partial pages fail closed', async () => {
  for (const products of [
    [{ ...row(), locality: { region: 'nl-ams' } }],
    [{ ...row(), unit_of_measure: { unit: 'hour', size: 1 } }],
    [row(), row()],
    [row(), { ...row(), sku: 'different' }],
    [{ ...row(), price: null }],
  ])
    await assert.rejects(
      listDedicatedPrices(new AbortController().signal, async () => ({
        products,
        total_count: products.length,
      })),
    );
  await assert.rejects(
    listDedicatedPrices(new AbortController().signal, async () => ({
      products: [row()],
      total_count: 2,
    })),
    /incomplete_page/,
  );
});

test('actual HTTPS adapter allowlists public managed inference and strips credentials', async () => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const { getJSON } = require('../dist/provider');
  const original = https.request;
  let sends = 0;
  try {
    https.request = (options, onResponse) => {
      sends++;
      assert.equal(options.hostname, 'api.scaleway.com');
      assert.equal(options.method, 'GET');
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      const request = new EventEmitter();
      request.destroy = () => {};
      request.end = () => {
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = { 'content-type': 'application/json' };
          response.destroy = () => {};
          onResponse(response);
          response.emit(
            'data',
            Buffer.from(JSON.stringify({ products: [], total_count: 0 })),
          );
          response.emit('end');
        });
      };
      return request;
    };
    await getJSON(
      'control',
      '/product-catalog/v2alpha1/public-catalog/products?product_types=managed_inference&region=fr-par&page=1&page_size=100',
      'do_not_send_this',
      new AbortController().signal,
    );
    assert.equal(sends, 1);
    await assert.rejects(
      getJSON(
        'control',
        '/product-catalog/v2alpha1/public-catalog/products?product_types=managed_inference&region=fr-par&page=6&page_size=100',
        '',
        new AbortController().signal,
      ),
      /invalid_request/,
    );
    await assert.rejects(
      getJSON(
        'control',
        '/product-catalog/v2alpha1/public-catalog/products?product_types=managed_inference&region=fr-par&page=1&page_size=100&currency=EUR',
        '',
        new AbortController().signal,
      ),
      /invalid_request/,
    );
    assert.equal(sends, 1);
  } finally {
    https.request = original;
  }
});

test('minute period corroboration uses exact pinned SKU/node/region/amount and never rounds hourly equivalent', async () => {
  const { corroboratedPublicPrice } = require('../dist/dedicatedPrices');
  const [price] = await listDedicatedPrices(
    new AbortController().signal,
    async () => ({ products: [row()], total_count: 1 }),
  );
  const proof = corroboratedPublicPrice(price);
  assert.equal(proof.minuteEUR, '0.05666');
  assert.equal(proof.hourlyEquivalentEUR, '3.3996');
  assert.equal(proof.accountEffectivePrice, 'unknown');
  assert.equal(proof.source, 'pinned-public-pricing-corroboration');
  for (const change of [
    { amountEUR: '0.06' },
    { nodeTypeName: 'H100-2' },
    { sku: 'other' },
    { region: 'nl-ams' },
    { currency: 'USD' },
    { unit: 'hour' },
    { size: 60 },
  ])
    assert.equal(corroboratedPublicPrice({ ...price, ...change }), undefined);
});

test('seven actual public price observations exactly agree with structured official perMinute SKU evidence', () => {
  const fs = require('node:fs');
  const { corroboratedPublicPrice } = require('../dist/dedicatedPrices');
  const observed = JSON.parse(
    fs.readFileSync(
      '../../specifications/references/documentation/dedicated-prices-v30/public-price-observations.json',
      'utf8',
    ),
  );
  const source = JSON.parse(
    fs.readFileSync(
      '../../specifications/references/documentation/dedicated-prices-v30/pricing-page-managed-inference-extract.json',
      'utf8',
    ),
  );
  assert.equal(observed.length, 7);
  for (const price of observed) {
    const node = source.nodeTypes.find(
      (node) => node.apiId === price.nodeTypeName,
    );
    const regional = node.regions.find(
      (region) => region.region === price.region,
    );
    assert.equal(regional.price.perMinute.sku, price.sku);
    assert.equal(regional.price.perMinute.isApproximation, false);
    assert.equal(
      corroboratedPublicPrice(price).hourlyEquivalentEUR,
      moneyEUR({
        currency_code: regional.price.hourly.value.currencyCode,
        units: regional.price.hourly.value.units,
        nanos: regional.price.hourly.value.nanos,
      }),
    );
  }
});
