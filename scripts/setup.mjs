import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// Load service account
const saPath = resolve(rootDir, 'kvs-traders-firebase-adminsdk-fbsvc-d9eae37959.json');
const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

function hashPin(pin) {
  return createHash('sha256').update(pin + '_kvs_salt_2026').digest('hex');
}

async function setup() {
  console.log('Setting up SpiceSentry...\n');

  // 1. Create owner account
  const ownerUid = 'admin_owner';
  const ownerPin = '1234';
  console.log('Creating owner account...');
  await db.collection('users').doc(ownerUid).set({
    name: 'Admin',
    pin: hashPin(ownerPin),
    role: 'owner',
    shop: null,
    active: true,
    createdAt: Date.now(),
  });
  console.log(`  Owner created: name="Admin", PIN=${ownerPin}, uid="${ownerUid}"`);

  // 2. Create a sample staff account
  const staffUid = 'staff_demo';
  const staffPin = '5678';
  console.log('Creating sample staff account...');
  await db.collection('users').doc(staffUid).set({
    name: 'Staff',
    pin: hashPin(staffPin),
    role: 'staff',
    shop: '20 Acre',
    active: true,
    createdAt: Date.now(),
  });
  console.log(`  Staff created: name="Staff", PIN=${staffPin}, shop="20 Acre", uid="${staffUid}"`);

  // 3. Initialize config documents
  console.log('Initializing config...');
  await db.collection('config').doc('shops').set({
    list: [
      { name: '20 Acre', active: true },
      { name: 'Anachal', active: true },
      { name: 'Kallar', active: true },
    ]
  });
  await db.collection('config').doc('spices').set({
    list: [
      { id: 'cardamom', label: 'Cardamom', color: 'var(--cardamom-main)', active: true },
      { id: 'pepper', label: 'Pepper', color: 'var(--pepper-main)', active: true },
      { id: 'nutmeg', label: 'Nutmeg', color: 'var(--nutmeg-main)', active: true },
      { id: 'nutmeg_mace', label: 'Nutmeg mace', color: 'var(--nutmeg-main)', active: true },
      { id: 'coffee', label: 'Coffee', color: 'var(--coffee-main)', active: true },
      { id: 'clove', label: 'Clove', color: 'var(--clove-main)', active: true },
    ]
  });
  await db.collection('config').doc('settings').set({
    gsheetUrl: 'https://script.google.com/macros/s/AKfycbzWGVOetrbZMaN0XSKV94Yj_5HXKg2GwpFB8WPXwrtLZqt0HTAz9oBWs3TKxq7KtqypAQ/exec',
  });
  console.log('  Config initialized (shops, spices, settings)');

  console.log('\n========================================');
  console.log('  SETUP COMPLETE');
  console.log('========================================');
  console.log('\n  OWNER LOGIN:');
  console.log('    Name:  Admin');
  console.log('    PIN:   1234');
  console.log('\n  STAFF LOGIN (demo):');
  console.log('    Name:  Staff');
  console.log('    PIN:   5678');
  console.log('\n  Change these PINs from the CPanel after logging in as owner.');
  console.log('========================================\n');

  process.exit(0);
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  console.error('\nMake sure Firestore Database is created in Firebase Console:');
  console.error('  Firebase Console → Build → Firestore Database → Create database');
  process.exit(1);
});
