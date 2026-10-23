"""Isolated Strands transport tests, no credentials or network.
Run with pinned discovery venv python; not production Agent security tests.
"""
import asyncio
import unittest
import httpx
from strands.models.openai import OpenAIModel

MESSAGES = [{"role": "user", "content": [{"text": "Reply OK."}]}]

def model(transport, **params):
    client = httpx.AsyncClient(transport=transport, follow_redirects=False)
    return OpenAIModel(model_id="fixture-model", params={"max_tokens": 128, **params},
        client_args={"api_key": "synthetic-not-a-key", "base_url": "https://fixture.invalid/project/v1/",
                     "max_retries": 0, "http_client": client}), client

class TransportChecks(unittest.IsolatedAsyncioTestCase):
    async def test_stream_usage_and_completion(self):
        chunks = [
            {"id":"fixture", "object":"chat.completion.chunk", "created":0, "model":"fixture-model", "choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":None}]},
            {"id":"fixture", "object":"chat.completion.chunk", "created":0, "model":"fixture-model", "choices":[{"index":0,"delta":{},"finish_reason":"stop"}]},
            {"id":"fixture", "object":"chat.completion.chunk", "created":0, "model":"fixture-model", "choices":[], "usage":{"prompt_tokens":6,"completion_tokens":1,"total_tokens":7}}
        ]
        body = "".join("data: " + __import__('json').dumps(x) + "\n\n" for x in chunks) + "data: [DONE]\n\n"
        calls=[]
        def handler(request):
            calls.append(request)
            return httpx.Response(200, headers={"content-type":"text/event-stream"}, content=body)
        m,c=model(httpx.MockTransport(handler))
        try:
            events=[e async for e in m.stream(MESSAGES)]
            self.assertTrue(any('messageStop' in e for e in events))
            usage=next(e['metadata']['usage'] for e in events if 'metadata' in e)
            self.assertEqual(usage['inputTokens'],6)
            self.assertEqual(len(calls),1)
            self.assertEqual(calls[0].url.path,'/project/v1/chat/completions')
        finally: await c.aclose()

    async def test_auth_failure_has_no_retry(self):
        calls=[]
        def handler(request):
            calls.append(request)
            return httpx.Response(403,json={"error":{"message":"synthetic denial","type":"permission_error"}})
        m,c=model(httpx.MockTransport(handler))
        try:
            with self.assertRaises(Exception):
                _=[e async for e in m.stream(MESSAGES)]
            self.assertEqual(len(calls),1)
        finally: await c.aclose()

    async def test_redirect_not_followed(self):
        calls=[]
        def handler(request):
            calls.append(request)
            return httpx.Response(302,headers={"location":"https://foreign.invalid/"})
        m,c=model(httpx.MockTransport(handler))
        try:
            with self.assertRaises(Exception):
                _=[e async for e in m.stream(MESSAGES)]
            self.assertEqual(len(calls),1)
        finally: await c.aclose()

    async def test_local_cancel_no_replay(self):
        entered=asyncio.Event(); calls=[]
        async def handler(request):
            calls.append(request); entered.set()
            await asyncio.sleep(60)
            return httpx.Response(200)
        m,c=model(httpx.MockTransport(handler))
        async def collect(): return [e async for e in m.stream(MESSAGES)]
        try:
            task=asyncio.create_task(collect())
            await asyncio.wait_for(entered.wait(),2)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
            self.assertEqual(len(calls),1)
            # This asserts local stop only, never remote rollback or zero billing.
        finally: await c.aclose()

    async def test_unsupported_option_requires_wrapper_validation(self):
        m,c=model(httpx.MockTransport(lambda request: httpx.Response(500)),frequency_penalty=1)
        try:
            request=m.format_request(MESSAGES)
            self.assertIn('frequency_penalty',request)
            allowed={'model','messages','tools','tool_choice','stream','stream_options','max_tokens','temperature'}
            self.assertNotEqual(set(request)-allowed,set())
        finally: await c.aclose()

if __name__=='__main__': unittest.main()
