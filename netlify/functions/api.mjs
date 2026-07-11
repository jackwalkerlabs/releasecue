import { getStore } from '@netlify/blobs';
import { createApi } from '../../src/api.js';

let api;
export default async function handler(request) {
  api ||= createApi({ store: getStore('releasecue', { consistency: 'strong' }) });
  return api(request);
}
