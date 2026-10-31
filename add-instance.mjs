#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTANCES_DIR = path.join(__dirname, 'instances');

const [, , name, type] = process.argv;

if (!name || !type) {
  console.error('Usage: node add-instance.mjs <instance-name> <zalo|whatsapp>');
  process.exit(1);
}

const normalizedType = type.toLowerCase();
if (!['zalo', 'wa', 'whatsapp', 'zalo-tg'].includes(normalizedType)) {
  console.error('Type must be: zalo, zalo-tg, whatsapp, or wa');
  process.exit(1);
}

const instanceDir = path.join(INSTANCES_DIR, name);

if (existsSync(instanceDir)) {
  console.error(`Instance "${name}" already exists`);
  process.exit(1);
}

mkdirSync(instanceDir, { recursive: true });

const typeValue = normalizedType === 'wa' ? 'whatsapp' : normalizedType === 'zalo-tg' ? 'zalo' : normalizedType;
writeFileSync(path.join(instanceDir, '.type'), typeValue);

const envTemplate = `# ${typeValue === 'whatsapp' ? 'WhatsApp' : 'Zalo'} Bridge Instance: ${name}
TG_TOKEN=
TG_GROUP_ID=
DATA_DIR=../../data
`;

if (typeValue === 'whatsapp') {
  writeFileSync(path.join(instanceDir, '.env'), envTemplate.replace('DATA_DIR=../../data', 'DATA_DIR=../../data\nWA_ACCOUNT_ID=' + name));
} else {
  writeFileSync(path.join(instanceDir, '.env'), envTemplate + 'ZALO_CREDENTIALS_PATH=credentials.json\n');
}

console.log(`Created instance "${name}" (${typeValue}) at ${instanceDir}`);
console.log('Edit the .env file with your credentials, then run: node manager.mjs');