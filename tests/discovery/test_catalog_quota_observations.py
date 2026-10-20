"""Offline evidence invariants; not API/IAM conformance or quota balance proof."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(path):
    return json.loads((ROOT / path).read_text())


class CatalogQuotaObservations(unittest.TestCase):
    def setUp(self):
        self.fixture = load('tests/discovery/fixtures/catalog-quota-observations.json')

    def test_capture_notes_are_not_raw_or_live_schema_proof(self):
        self.assertIn('NOT raw API', self.fixture['kind'])
        self.assertEqual(self.fixture['provenance']['live_validation'], 'not_run')
        self.assertFalse(self.fixture['provenance']['independently_recaptured'])
        self.assertTrue(all(c['minimum_permission'] == 'unknown' for c in self.fixture['catalogs']))

    def test_distinct_catalog_populations_do_not_join_by_count(self):
        catalogs = self.fixture['catalogs']
        self.assertEqual([c['count'] for c in catalogs], [None, 58, 31, 12])
        self.assertEqual(len({c['offering'] for c in catalogs}), 4)
        self.assertEqual(len({c['route'] for c in catalogs}), 4)
        self.assertNotEqual(catalogs[1]['auth'], catalogs[0]['auth'])
        self.assertEqual(catalogs[2]['auth'], 'unknown for this route')

    def test_quota_capture_preserves_unknown_fields_and_singular_path(self):
        q = self.fixture['quotas']
        self.assertTrue(q['route'].endswith('/quota'))
        self.assertEqual((q['requested_page'], q['requested_page_size']), (3, 100))
        for key in ['maximum_page_size', 'exact_technical_names', 'exact_numeric_limits',
                    'outer_schema', 'total_count', 'remaining_consumption', 'minimum_permission', 'auth']:
            self.assertIsNone(q[key])
        self.assertEqual(q['reported_fields'], ['name', 'limit', 'pretty_name'])
        self.assertNotIn('quota_name_to_model', q)  # no localized-label join invented

    def test_zero_false_null_missing_and_stock_are_distinct(self):
        cases = {c['name']: c for c in self.fixture['synthetic_cases']}
        zero = cases['zero-is-known-not-missing']
        missing = cases['missing-consumption']
        stock = cases['available-stock-not-quota']
        self.assertEqual((zero['limit'], zero['consumed'], zero['remaining']), (0, 0, 0))
        self.assertIsNone(missing['remaining'])
        self.assertIsNone(stock['organization_limit'])
        self.assertIs(stock['disabled'], False)
        self.assertNotIn('disabled', zero)
        self.assertTrue(all(c['can_infer'] is False for c in cases.values()))

    def test_contradictions_are_not_silently_resolved(self):
        rows = {r['id']: r for r in self.fixture['contradictions']}
        self.assertEqual(set(rows), {'iam-renaming', 'quota-scope', 'catalog-counts', 'quota-stock'})
        self.assertEqual(rows['iam-renaming']['resolution'], 'unresolved')
        self.assertIn('unknown', rows['quota-scope']['resolution'])
        self.assertIn('actual inference/tools/stream/usage/Strands compatibility', self.fixture['unknowns'])

    def test_source_derived_routes_and_scope_queries(self):
        inventory = load('evidence/schemas/dedicated-read-operations.source-derived.json')
        self.assertIn('NOT OpenAPI', inventory['kind'])
        ops = {op['sdk_method']: op for op in inventory['operations']}
        self.assertTrue(all(op['http_method'] == 'GET' for op in ops.values()))
        self.assertIn('project_id', ops['pageOfListModels']['query_wire_names'])
        self.assertIn('organization_id', ops['pageOfListProjects']['query_wire_names'])
        self.assertNotIn('order_by', ops['pageOfListNodeTypes']['query_wire_names'])
        self.assertIn('include_disabled_types', ops['pageOfListNodeTypes']['query_wire_names'])
        self.assertFalse(any('listEndpoints' in key for key in ops))
        self.assertFalse(any('/quota' in op['path_expression'] for op in ops.values()))
        self.assertFalse(any('product-catalog' in op['path_expression'] for op in ops.values()))

    def test_partial_schema_never_supplies_invented_requiredness_or_balance(self):
        for prefix, response, field in [('dedicated', 'ListModelsResponse', 'models'),
                                        ('projects', 'ListProjectsResponse', 'projects'),
                                        ('dedicated', 'ListNodeTypesResponse', 'node_types')]:
            schema = load('evidence/schemas/' + prefix + '-response-shapes.schema.json')
            self.assertIn('NOT official OpenAPI', schema['title'])
            shape = schema['$defs'][response]
            self.assertNotIn('required', shape)
            self.assertEqual(shape['properties']['total_count']['type'], 'integer')
            self.assertEqual(shape['properties']['total_count']['minimum'], 0)
            self.assertEqual(shape['properties'][field]['type'], 'array')
            self.assertNotIn('remaining', shape['properties'])
        self.assertIn('endpoints', load('evidence/schemas/dedicated-response-shapes.schema.json')['$defs']['Deployment']['properties'])

    def test_iam_source_conflict_and_quota_not_stock_remain_in_contract(self):
        text = (ROOT / 'specifications/providers/scaleway/dedicated.md').read_text()
        self.assertIn('IAM contradiction, unresolved', text)
        for name in ['InferenceReadOnly', 'GenerativeApisModelAccess', 'OrganizationReadOnly']:
            self.assertIn(name, text)
        self.assertIn('not organization quota', text)


if __name__ == '__main__':
    unittest.main()
