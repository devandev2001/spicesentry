import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const saPath = resolve(rootDir, 'kvs-traders-firebase-adminsdk-fbsvc-d9eae37959.json');
const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));

const PROJECT_ID = 'kvs-traders';

async function enableFirestore() {
  console.log('Authenticating with service account...');
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/datastore',
    ],
  });
  const authClient = await auth.getClient();

  // Step 1: Enable the Firestore API
  console.log('Enabling Cloud Firestore API...');
  const serviceUsage = google.serviceusage({ version: 'v1', auth: authClient });
  try {
    const enableRes = await serviceUsage.services.enable({
      name: `projects/${PROJECT_ID}/services/firestore.googleapis.com`,
    });
    console.log('  Firestore API enabled:', enableRes.data.name || 'OK');
  } catch (err) {
    if (err.message?.includes('already enabled') || err.code === 409) {
      console.log('  Firestore API already enabled.');
    } else {
      throw err;
    }
  }

  // Wait for propagation
  console.log('Waiting 10 seconds for API to propagate...');
  await new Promise(r => setTimeout(r, 10000));

  // Step 2: Create the Firestore database (native mode)
  console.log('Creating Firestore database...');
  const firestore = google.firestore({ version: 'v1', auth: authClient });
  try {
    const createRes = await firestore.projects.databases.create({
      parent: `projects/${PROJECT_ID}`,
      databaseId: '(default)',
      requestBody: {
        type: 'FIRESTORE_NATIVE',
        locationId: 'asia-south1',
      },
    });
    console.log('  Database created:', createRes.data.name || 'OK');
  } catch (err) {
    if (err.message?.includes('already exists') || err.code === 409) {
      console.log('  Database already exists.');
    } else {
      throw err;
    }
  }

  console.log('\nFirestore is ready. Now run: node scripts/setup.mjs');
}

enableFirestore().catch(err => {
  console.error('Failed:', err.message);
  if (err.message?.includes('permission') || err.message?.includes('403')) {
    console.error('\nThe service account may need "Editor" or "Owner" role on the project.');
    console.error('Go to: https://console.cloud.google.com/iam-admin/iam?project=kvs-traders');
    console.error('Find firebase-adminsdk-fbsvc@kvs-traders.iam.gserviceaccount.com');
    console.error('Give it the "Editor" role.');
  }
  process.exit(1);
});
