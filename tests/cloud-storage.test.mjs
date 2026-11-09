import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CloudStorage } from '../app/cloud-storage.mjs';
test('settings, tokens and media survive restart; removed tokens stay removed', async () => {
  const objects = new Map();
  const request = async (url, init = {}) => {
    const u = new URL(url), key = decodeURIComponent(u.pathname.slice('/store/'.length));
    if (u.searchParams.has('list')) return Response.json([...objects.keys()]);
    if (init.method === 'PUT') { objects.set(key, Buffer.from(await new Response(init.body).arrayBuffer())); return new Response('ok'); }
    if (init.method === 'DELETE') { objects.delete(key); return new Response('ok'); }
    return objects.has(key) ? new Response(objects.get(key)) : new Response('', {status:404});
  };
  const first = await fs.mkdtemp(path.join(os.tmpdir(), 'mudex-storage-'));
  const second = await fs.mkdtemp(path.join(os.tmpdir(), 'mudex-storage-'));
  const a = new CloudStorage(first, 'https://example.com/store/', 'secret', request);
  await a.restore();
  await fs.mkdir(path.join(first, 'data'), {recursive:true});
  await fs.mkdir(path.join(first, 'jobs', '학교'), {recursive:true});
  await fs.writeFile(path.join(first, 'data', 'hf_token.json'), 'private-token');
  await fs.writeFile(path.join(first, 'jobs', '학교', 'clip.mp4'), Buffer.from([0,1,2,255]));
  await fs.mkdir(path.join(first,'jobs','학교','review'),{recursive:true});
  await fs.writeFile(path.join(first,'jobs','학교','review','sheet.jpg'),'review-sheet');
  await a.sync();
  const b = new CloudStorage(second, 'https://example.com/store/', 'secret', request);
  await b.restore();
  assert.equal(await fs.readFile(path.join(second, 'data', 'hf_token.json'), 'utf8'), 'private-token');
  assert.deepEqual(await fs.readFile(path.join(second, 'jobs', '학교', 'clip.mp4')), Buffer.from([0,1,2,255]));
  assert.equal(await fs.readFile(path.join(second,'jobs','학교','review','sheet.jpg'),'utf8'),'review-sheet');
  await fs.unlink(path.join(second, 'data', 'hf_token.json'));
  await b.sync();
  assert.equal(objects.has('data/hf_token.json'), false);
  assert.equal(objects.has('jobs/학교/clip.mp4'), true);
});
