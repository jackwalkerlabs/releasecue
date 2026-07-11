import { getStore } from '@netlify/blobs';
import { createApi } from '../../src/api.js';

// Netlify v2 request handler; refresh request-scoped Blob credentials on every invocation.
export default async function handler(request) {
  return createApi({ store: getStore('releasecue', { consistency: 'strong' }) })(request);
}
