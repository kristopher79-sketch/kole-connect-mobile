function createMobilePaperworkRequestError(message, status = 0, code = '') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readMobilePaperworkError(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  throw createMobilePaperworkRequestError(
    data.error || fallbackMessage,
    response.status,
    data.code || '',
  );
}

export function getMobilePaperworkEndpoint(apiBaseUrl, loadId, documentId = '') {
  const loadPath = encodeURIComponent(String(loadId || '').trim());
  const documentPath = documentId
    ? `/${encodeURIComponent(String(documentId).trim())}`
    : '';

  return `${String(apiBaseUrl || '').replace(/\/+$/, '')}/mobile/loads/${loadPath}/paperwork${documentPath}`;
}

export async function getMobileLoadPaperwork({
  apiBaseUrl,
  token,
  loadId,
  signal,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(getMobilePaperworkEndpoint(apiBaseUrl, loadId), {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  });

  if (!response.ok) {
    return readMobilePaperworkError(response, 'Paperwork could not be loaded.');
  }

  const data = await response.json().catch(() => ({}));
  if (!Array.isArray(data.documents)) {
    throw createMobilePaperworkRequestError(
      'The server did not return a complete paperwork list.',
      response.status,
    );
  }

  return data.documents.filter((document) => (
    document &&
    String(document.id || '').trim() &&
    String(document.name || '').trim() &&
    String(document.type || '').toLowerCase() === 'application/pdf'
  ));
}

export async function getMobilePaperworkPdf({
  apiBaseUrl,
  token,
  loadId,
  documentId,
  signal,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    getMobilePaperworkEndpoint(apiBaseUrl, loadId, documentId),
    {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal,
    },
  );

  if (!response.ok) {
    return readMobilePaperworkError(response, 'This paperwork could not be opened.');
  }

  const contentType = String(response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (contentType !== 'application/pdf') {
    throw createMobilePaperworkRequestError(
      'The server did not return a PDF document.',
      response.status,
    );
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw createMobilePaperworkRequestError('This paperwork PDF is empty.', response.status);
  }

  return blob.type === 'application/pdf'
    ? blob
    : new Blob([blob], { type: 'application/pdf' });
}

export function createMobilePaperworkObjectUrl(blob, urlApi = URL) {
  const objectUrl = urlApi.createObjectURL(blob);
  let revoked = false;

  return {
    objectUrl,
    viewerUrl: `${objectUrl}#toolbar=0&navpanes=0&view=FitH`,
    revoke() {
      if (revoked) return;
      revoked = true;
      urlApi.revokeObjectURL(objectUrl);
    },
  };
}

export function printMobilePaperworkFrame(frameWindow) {
  if (typeof frameWindow?.print !== 'function') return false;

  frameWindow.focus?.();
  frameWindow.print();
  return true;
}
