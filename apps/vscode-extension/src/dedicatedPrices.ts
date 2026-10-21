import { type GetJSON, getJSON, pages, ReadError, text } from './provider';
export interface DedicatedPriceObservation {
  nodeTypeName: string;
  sku: string;
  region: 'fr-par';
  currency: 'EUR';
  amountEUR: string;
  unit: 'node';
  size: 1;
  period: 'unspecified-in-catalog';
  source: 'public-retail-not-account-price';
  fetchedAt: string;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ReadError('invalid_price_response');
  return value as Record<string, unknown>;
}
/** Exact nanos projection; never floating arithmetic or inferred hourly conversion. */
export function moneyEUR(value: unknown): string {
  const money = record(value);
  if (
    money.currency_code !== 'EUR' ||
    !Number.isSafeInteger(money.units) ||
    Number(money.units) < 0 ||
    !Number.isSafeInteger(money.nanos) ||
    Number(money.nanos) < 0 ||
    Number(money.nanos) > 999999999
  )
    throw new ReadError('invalid_price_response');
  const units = BigInt(Number(money.units));
  const fraction = String(money.nanos).padStart(9, '0').replace(/0+$/, '');
  return units.toString() + (fraction ? ['.', fraction].join('') : '');
}
/** Public evidence only: compatibility and tariff period are separate host checks. */
export async function listDedicatedPrices(
  signal: AbortSignal,
  get: GetJSON = getJSON,
  now = new Date(),
): Promise<DedicatedPriceObservation[]> {
  const rows = await pages(
    'products',
    'control',
    '/product-catalog/v2alpha1/public-catalog/products?product_types=managed_inference&region=fr-par',
    '',
    signal,
    get,
  );
  const result: DedicatedPriceObservation[] = [];
  const skus = new Set<string>();
  const products = new Set<string>();
  for (const value of rows) {
    const row = record(value);
    if (
      !text(row.sku) ||
      !text(row.product) ||
      !text(row.status) ||
      record(row.locality).region !== 'fr-par'
    )
      throw new ReadError('invalid_price_response');
    if (skus.has(row.sku)) throw new ReadError('ambiguous_price');
    skus.add(row.sku);
    const unit = record(row.unit_of_measure);
    if (unit.unit === 'gigabyte') continue;
    if (unit.unit !== 'node' || unit.size !== 1)
      throw new ReadError('invalid_price_unit');
    if (row.status !== 'general_availability' && row.status !== 'public_beta')
      continue;
    record(record(row.properties).managed_inference);
    if (products.has(row.product)) throw new ReadError('ambiguous_price');
    products.add(row.product);
    result.push({
      nodeTypeName: row.product,
      sku: row.sku,
      region: 'fr-par',
      currency: 'EUR',
      amountEUR: moneyEUR(record(row.price).retail_price),
      unit: 'node',
      size: 1,
      period: 'unspecified-in-catalog',
      source: 'public-retail-not-account-price',
      fetchedAt: now.toISOString(),
    });
  }
  return result;
}

const minuteEvidence = [
  {
    nodeTypeName: 'H100',
    sku: '/ai/inference_dedicated/deployment/h100-1/fr-par',
    region: 'fr-par',
    amountEUR: '0.05666',
  },
  {
    nodeTypeName: 'H100-2',
    sku: '/ai/inference_dedicated/deployment/h100-2/fr-par',
    region: 'fr-par',
    amountEUR: '0.11133',
  },
  {
    nodeTypeName: 'H100-SXM-2',
    sku: '/ai/inference_dedicated/deployment/h100-sxm-2/fr-par',
    region: 'fr-par',
    amountEUR: '0.1325',
  },
  {
    nodeTypeName: 'H100-SXM-4',
    sku: '/ai/inference_dedicated/deployment/h100-sxm-4/fr-par',
    region: 'fr-par',
    amountEUR: '0.253666',
  },
  {
    nodeTypeName: 'H100-SXM-8',
    sku: '/ai/inference_dedicated/deployment/h100-sxm-8/fr-par',
    region: 'fr-par',
    amountEUR: '0.501',
  },
  {
    nodeTypeName: 'L4',
    sku: '/ai/inference_dedicated/deployment/l4/fr-par',
    region: 'fr-par',
    amountEUR: '0.0155',
  },
  {
    nodeTypeName: 'L40S',
    sku: '/ai/inference_dedicated/deployment/l40s/fr-par',
    region: 'fr-par',
    amountEUR: '0.02866',
  },
] as const;

export interface CorroboratedPublicPrice {
  minuteEUR: string;
  hourlyEquivalentEUR: string;
  source: 'pinned-public-pricing-corroboration';
  pricingURL: 'https://www.scaleway.com/en/pricing/model-as-a-service/';
  observedOn: '2026-10-21';
  accountEffectivePrice: 'unknown';
}
/** Reject changed prices rather than silently promoting a stale reference into a current quote. */
export function corroboratedPublicPrice(
  observation: DedicatedPriceObservation,
): CorroboratedPublicPrice | undefined {
  const match = minuteEvidence.some(
    (proof) =>
      proof.nodeTypeName === observation.nodeTypeName &&
      proof.sku === observation.sku &&
      proof.region === observation.region &&
      proof.amountEUR === observation.amountEUR,
  );
  if (
    !match ||
    observation.currency !== 'EUR' ||
    observation.unit !== 'node' ||
    observation.size !== 1
  )
    return;
  const [whole, fraction = ''] = observation.amountEUR.split('.');
  const nanos =
    (BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'))) * 60n;
  const hourFraction = (nanos % 1000000000n)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '');
  return {
    minuteEUR: observation.amountEUR,
    hourlyEquivalentEUR: [
      (nanos / 1000000000n).toString(),
      ...(hourFraction ? [hourFraction] : []),
    ].join('.'),
    source: 'pinned-public-pricing-corroboration',
    pricingURL: 'https://www.scaleway.com/en/pricing/model-as-a-service/',
    observedOn: '2026-10-21',
    accountEffectivePrice: 'unknown',
  };
}
