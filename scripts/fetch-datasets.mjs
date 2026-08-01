#!/usr/bin/env node

/**
 * Downloads only the two public, direct-download datasets recorded in
 * datasets.manifest.json. Restricted/DUA datasets are intentionally excluded.
 *
 * Usage:
 *   node scripts/fetch-datasets.mjs
 *   node scripts/fetch-datasets.mjs ut-endomri
 *   node scripts/fetch-datasets.mjs umd
 *
 * All files land in .datasets/, which is intentionally git-ignored.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'datasets.manifest.json'), 'utf8'));
const selectedIds = process.argv.slice(2);
const candidates = manifest.datasets.filter((dataset) => dataset.downloadUrl);
const datasets = selectedIds.length
  ? candidates.filter((dataset) => selectedIds.includes(dataset.id))
  : candidates;

if (!datasets.length || (selectedIds.length && datasets.length !== selectedIds.length)) {
  console.error(`Choose one or more public dataset IDs: ${candidates.map((item) => item.id).join(', ')}`);
  process.exit(1);
}

for (const dataset of datasets) {
  const destination = resolve(root, dataset.localPath);
  if (existsSync(destination)) {
    console.log(`Skipping ${dataset.id}: ${dataset.localPath} already exists.`);
    continue;
  }

  mkdirSync(dirname(destination), { recursive: true });
  console.log(`Downloading ${dataset.name} to ${dataset.localPath}`);
  console.log(`Terms: ${dataset.commercialUse}`);
  const response = await fetch(dataset.downloadUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`${dataset.id}: download failed (${response.status} ${response.statusText})`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx' }));
  console.log(`Finished ${dataset.id}.`);
}
