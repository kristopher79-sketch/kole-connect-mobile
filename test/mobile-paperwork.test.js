import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMobilePaperworkObjectUrl,
  getMobileLoadPaperwork,
  getMobilePaperworkEndpoint,
  getMobilePaperworkPdf,
  printMobilePaperworkFrame,
} from '../src/mobile-paperwork.js';

test('paperwork endpoints encode opaque load and document identifiers', () => {
  assert.equal(
    getMobilePaperworkEndpoint('https://example.test/', '101', 'opaque ! id'),
    'https://example.test/mobile/loads/101/paperwork/opaque%20!%20id',
  );
});

test('paperwork listing is authenticated and keeps only PDF metadata', async () => {
  let request;
  const documents = await getMobileLoadPaperwork({
    apiBaseUrl: 'https://example.test',
    token: 'mobile-token',
    loadId: '101',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        success: true,
        documents: [
          { id: 'pdf', name: 'Customer BOL.pdf', type: 'application/pdf' },
          { id: 'image', name: 'Photo.jpg', type: 'image/jpeg' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(request.url, 'https://example.test/mobile/loads/101/paperwork');
  assert.equal(request.options.headers.Authorization, 'Bearer mobile-token');
  assert.equal(request.options.cache, 'no-store');
  assert.deepEqual(documents, [
    { id: 'pdf', name: 'Customer BOL.pdf', type: 'application/pdf' },
  ]);
});

test('PDF request remains authenticated and rejects another content type', async () => {
  let authorization = '';

  await assert.rejects(
    getMobilePaperworkPdf({
      apiBaseUrl: 'https://example.test',
      token: 'mobile-token',
      loadId: '101',
      documentId: 'doc-a',
      fetchImpl: async (_url, options) => {
        authorization = options.headers.Authorization;
        return new Response('not a pdf', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      },
    }),
    /did not return a PDF document/,
  );

  assert.equal(authorization, 'Bearer mobile-token');
});

test('temporary PDF object URLs are revoked once when the viewer closes', () => {
  const calls = [];
  const lease = createMobilePaperworkObjectUrl(
    new Blob(['pdf'], { type: 'application/pdf' }),
    {
      createObjectURL: () => 'blob:paperwork',
      revokeObjectURL: (url) => calls.push(url),
    },
  );

  assert.equal(lease.viewerUrl, 'blob:paperwork#toolbar=0&navpanes=0&view=FitH');
  lease.revoke();
  lease.revoke();
  assert.deepEqual(calls, ['blob:paperwork']);
});

test('Print targets the loaded PDF frame without opening another URL', () => {
  const calls = [];
  const printed = printMobilePaperworkFrame({
    focus: () => calls.push('focus'),
    print: () => calls.push('print'),
  });

  assert.equal(printed, true);
  assert.deepEqual(calls, ['focus', 'print']);
  assert.equal(printMobilePaperworkFrame(null), false);
});
