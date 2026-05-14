import json
import os
import tempfile
import unittest
from unittest.mock import patch

import App as backend


class FakeResponsesAPI:
    def create(self, **kwargs):
        self.kwargs = kwargs

        class FakeResponse:
            output_text = json.dumps(
                {
                    'answer': 'Reset the tenant certificate. Sources: SSO redirect loop.',
                    'citation_ids': ['page-1', 'unknown-page'],
                    'refusal': False,
                }
            )

        return FakeResponse()


class FakeOpenAIClient:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self.responses = FakeResponsesAPI()


class KnowledgeBaseApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, 'db.json')
        backend.app.config['TESTING'] = True
        backend.app.config['DB_FILE'] = self.db_path
        self.client = backend.app.test_client()

    def tearDown(self):
        backend.app.config.pop('DB_FILE', None)
        self.temp_dir.cleanup()

    def write_db(self, payload):
        with open(self.db_path, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle)

    def read_db(self):
        with open(self.db_path, 'r', encoding='utf-8') as handle:
            return json.load(handle)

    def test_read_db_normalizes_old_records(self):
        self.write_db(
            [
                {
                    'summary': 'Legacy entry',
                    'sf_case': '00111111',
                    'jira_link': '',
                    'description': 'A legacy record.',
                    'solution': 'A legacy fix.',
                }
            ]
        )

        records = backend.read_db()

        self.assertTrue(records[0]['id'])
        self.assertEqual(records[0]['related_page_ids'], [])
        self.assertIsNone(records[0]['deleted_at'])
        self.assertTrue(self.read_db()[0]['id'])

    def test_create_rejects_invalid_related_page_ids(self):
        self.write_db([])

        response = self.client.post(
            '/api/knowledge',
            json={
                'summary': 'New entry',
                'sf_case': '00120000',
                'jira_link': '',
                'description': 'A new issue.',
                'solution': 'A new fix.',
                'related_page_ids': ['missing-page'],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('related pages', response.get_json()['error'].lower())

    def test_update_rejects_self_reference_and_unknown_ids(self):
        self.write_db(
            [
                {
                    'id': 'page-1',
                    'summary': 'Entry one',
                    'sf_case': '00100001',
                    'jira_link': '',
                    'description': 'Issue one',
                    'solution': 'Fix one',
                    'related_page_ids': [],
                    'deleted_at': None,
                }
            ]
        )

        self.assertEqual(
            self.client.put(
                '/api/knowledge/page-1',
                json={
                    'summary': 'Entry one',
                    'sf_case': '00100001',
                    'jira_link': '',
                    'description': 'Issue one',
                    'solution': 'Fix one',
                    'related_page_ids': ['page-1'],
                },
            ).status_code,
            400,
        )

        self.assertEqual(
            self.client.put(
                '/api/knowledge/page-1',
                json={
                    'summary': 'Entry one',
                    'sf_case': '00100001',
                    'jira_link': '',
                    'description': 'Issue one',
                    'solution': 'Fix one',
                    'related_page_ids': ['missing-page'],
                },
            ).status_code,
            400,
        )

    def test_archive_restore_and_view_filtering(self):
        self.write_db(
            [
                {
                    'id': 'page-1',
                    'summary': 'Entry one',
                    'sf_case': '00100001',
                    'jira_link': '',
                    'description': 'Issue one',
                    'solution': 'Fix one',
                    'related_page_ids': [],
                    'deleted_at': None,
                }
            ]
        )

        self.client.post('/api/knowledge/page-1/archive')
        active_response = self.client.get('/api/knowledge?view=active')
        archived_response = self.client.get('/api/knowledge?view=archived')

        self.assertEqual(active_response.get_json(), [])
        self.assertEqual(len(archived_response.get_json()), 1)

        self.client.post('/api/knowledge/page-1/restore')
        restored_response = self.client.get('/api/knowledge?view=active')
        self.assertEqual(len(restored_response.get_json()), 1)

    def test_assistant_returns_refusal_when_no_page_matches(self):
        self.write_db(
            [
                {
                    'id': 'page-1',
                    'summary': 'SSO redirect loop',
                    'sf_case': '00123456',
                    'jira_link': '',
                    'description': 'Users are sent back to login.',
                    'solution': 'Reset the certificate.',
                    'related_page_ids': [],
                    'deleted_at': None,
                }
            ]
        )

        response = self.client.post(
            '/api/assistant/chat',
            json={'messages': [{'role': 'user', 'content': 'How do I configure invoices?'}]},
        )

        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data['refusal'])
        self.assertEqual(data['citations'], [])

    def test_assistant_filters_citations_to_matched_pages(self):
        self.write_db(
            [
                {
                    'id': 'page-1',
                    'summary': 'SSO redirect loop',
                    'sf_case': '00123456',
                    'jira_link': '',
                    'description': 'Users are sent back to login.',
                    'solution': 'Reset the certificate.',
                    'related_page_ids': [],
                    'deleted_at': None,
                }
            ]
        )

        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-key'}, clear=False):
            with patch.object(backend, 'OpenAI', FakeOpenAIClient):
                response = self.client.post(
                    '/api/assistant/chat',
                    json={
                        'messages': [
                            {'role': 'user', 'content': 'How do I fix the SSO redirect loop?'}
                        ]
                    },
                )

        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(data['refusal'])
        self.assertEqual(len(data['citations']), 1)
        self.assertEqual(data['citations'][0]['id'], 'page-1')


if __name__ == '__main__':
    unittest.main()
