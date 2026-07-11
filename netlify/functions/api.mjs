import { getStore } from '@netlify/blobs';
import { createApi } from '../../src/api.js';

let api;
// Netlify v2 request handler; state is persisted in strongly consistent Blobs.
export default async function handler(request) {
  api ||= createApi({ store: getStore('releasecue', { consistency: 'strong' }) });
  return api(request);
}
