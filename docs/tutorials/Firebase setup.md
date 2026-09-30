# Connect the Procedural Voxel World to Firebase

This tutorial connects the existing Vite + React project in `react-practice/` to Cloud Firestore and verifies that the connection works. It does **not** implement Save World or Load World yet, and it does not require changing the voxel-generation code.

Official references:

- [Add Firebase to a JavaScript project](https://firebase.google.com/docs/web/setup)
- [Cloud Firestore quickstart](https://firebase.google.com/docs/firestore/quickstart)
- [Firebase API keys and security](https://firebase.google.com/docs/projects/api-keys)
- [Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)

## What Firebase should store

Firestore should store the compact instructions needed to reproduce a world:

- random seed;
- density shape and density parameters;
- ordered CSG operations;
- chunking settings;
- meshing settings;
- an optional small performance-results object;
- a schema version for future migrations.

Do **not** store the generated density grid, voxel array, mesh vertices, or rendered geometry. The browser should regenerate those locally from the saved parameters.

A future Firestore document could have this general shape:

```js
{
  schemaVersion: 1,
  name: 'Planet experiment 01',
  seed: 42,
  density: {
    shape: 'planet',
    resolution: 100,
    radius: 4.5,
    noiseScale: 0.08,
    noiseAmplitude: 1.2,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2,
  },
  csgOperations: [
    {
      order: 0,
      operation: 'subtraction',
      shape: 'sphere',
      position: { x: 0, y: 3, z: 0 },
      size: 2.5,
      smoothness: 0,
    },
  ],
  chunking: {
    enabled: false,
    chunkSize: 6,
    activeChunkRadius: 4,
  },
  meshing: {
    enabled: false,
    method: 'marchingCubes',
    gridResolution: 24,
    isovalue: 0,
    smoothShading: true,
  },
  performance: {
    voxelGenerationMs: 0,
    meshGenerationMs: 0,
  },
}
```

This is only a preview of the eventual data model. Do not add Save/Load behavior during this setup stage.

## Before you begin

Confirm that Node.js and npm work:

```bash
node --version
npm --version
```

Run all project commands from:

```bash
cd /Users/wuyuying/Documents/Github_Project/Coursework-Cornell-AAP-IT/react-practice
```

## Step 1 — Create a Firebase project

### In the Firebase Console

1. Open the [Firebase Console](https://console.firebase.google.com/) and sign in.
2. Click **Create a project** or **Add project**.
3. Enter a name such as `procedural-voxel-world`.
4. Review the generated **Project ID**. The ID must be globally unique and cannot be changed later, although the display name can be changed.
5. Click **Continue**.
6. Gemini in Firebase is optional; it is not required for this project.
7. Google Analytics is also optional. Select **Disable Google Analytics** for the simplest setup unless you specifically want usage analytics.
8. Click **Create project**, wait for provisioning to finish, and then click **Continue**.

### Local command

No project command is required for this step.

```bash
# No local command yet.
```

### Example code

No code is added in this step.

### What this does

The Firebase project is the cloud container that will own the web-app registration, Firestore database, Security Rules, and any services added later.

## Step 2 — Register the existing Vite app as a Firebase web app

### In the Firebase Console

1. On **Project Overview**, click the **Web** icon (`</>`). If another app is already registered, click **Add app** and then choose **Web**.
2. Enter an app nickname such as `voxel-world-web`.
3. Leave **Also set up Firebase Hosting** unchecked. Hosting is not needed to connect a locally running Vite app to Firestore and can be added later.
4. Click **Register app**.
5. Select the **npm** setup option if the console offers multiple choices.
6. Keep the page open or copy the displayed `firebaseConfig` object. Its values will be used in Step 7.
7. Click **Continue to console** when finished.

You can retrieve the config later from **Project settings** (gear icon) → **General** → **Your apps** → select `voxel-world-web` → **SDK setup and configuration** → **Config**.

### Local command

No local command is required yet.

```bash
# No local command yet.
```

### Example code

The console will display an object similar to this. Use the actual values from your own project; do not copy these placeholders literally.

```js
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
}
```

### What this does

Registering the web app gives the browser a Firebase configuration object. It identifies which Firebase project the application should contact. It does not grant unrestricted database access; Firestore Security Rules control access.

## Step 3 — Enable only the Firebase services needed now

### In the Firebase Console

Enable **Cloud Firestore** now. The remaining services can wait:

| Service | Enable now? | Reason |
| --- | --- | --- |
| Cloud Firestore | Yes | Stores small structured world-configuration documents and optional experiment summaries. |
| Authentication | Later | Needed when worlds must belong to individual users, but not required for the first connection test. |
| App Check | Later, before production | Helps reject requests that do not come from an approved app. |
| Hosting | Optional later | Only needed if Firebase will host the built website. |
| Analytics | Optional | Not required for saving or loading worlds. |
| Cloud Storage | No | Raw voxel data and generated meshes should not be uploaded. |
| Realtime Database | No | Firestore already fits this document-shaped data model. |
| Cloud Functions | Not now | No trusted server-side workflow is required for the connection test. |

### Local command

No command is required while choosing services.

```bash
# No local command for this decision.
```

### Example code

Only the Firestore client will be initialized:

```js
import { getFirestore } from 'firebase/firestore'
```

### What this does

Keeping the first setup small reduces complexity. Firestore is enough to prove that the React app can reach Firebase and is appropriate for the parameter objects this project will eventually save.

## Step 4 — Create the Cloud Firestore database

### In the Firebase Console

1. In the left navigation, open **Build** or **Databases & Storage**, then click **Firestore Database** or **Firestore**. Console labels can vary slightly.
2. Click **Create database**.
3. If asked for an edition, choose **Standard edition**.
4. Use the default database ID, usually `(default)`.
5. Choose a database location close to the expected users. For this coursework prototype, a nearby US region is reasonable if you are working in the United States. Choose carefully because the location is difficult or impossible to change after creation.
6. For this first browser connection test, choose **Start in test mode**.
7. Read the warning: test mode temporarily permits broad client access. Do not publish the application with these rules.
8. Click **Create** or **Enable** and wait until the Firestore data page appears.

### Local command

No local command creates the hosted database in this workflow.

```bash
# Create Firestore in the Firebase Console.
```

### Example code

Test mode is represented by temporary rules similar to the following. Use the rules generated by the console rather than replacing them at this stage.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(YEAR, MONTH, DAY);
    }
  }
}
```

The console supplies a real expiration date in place of `YEAR, MONTH, DAY`.

### What this does

This creates the hosted document database. Test mode lets the unauthenticated local app perform one controlled connection test. It is not a production security configuration.

## Step 5 — Decide when to add Firebase Authentication

### In the Firebase Console

You do **not** need Authentication for the initial connection test. Leave **Build → Authentication** unconfigured for now.

Add Authentication before any of these become true:

- the app is deployed publicly;
- different people need private saved worlds;
- Firestore rules need to enforce ownership such as `ownerId == request.auth.uid`;
- saved configurations should follow a user across devices.

When that time comes, go to **Build → Authentication → Get started**, open **Sign-in method**, and enable an appropriate provider. Google sign-in is convenient for a class project; anonymous authentication can also provide a lightweight upgrade path, but anonymous accounts need careful account-linking if users later sign in permanently.

### Local command

No Authentication package needs to be installed separately; it is part of the Firebase JavaScript SDK installed in Step 6.

```bash
# No Authentication command is needed now.
```

### Example code

Do not add this yet. It shows the import that a later authentication stage would use:

```js
// Later only:
// import { getAuth } from 'firebase/auth'
```

### What this does

Deferring Authentication keeps this milestone focused on connectivity. Authentication identifies users, but Firestore Security Rules—not the Firebase configuration object—must authorize what those users can read and write.

## Step 6 — Install the Firebase JavaScript SDK

### In the Firebase Console

No console action is needed. Keep the registered web app and Firestore database available.

### Local command

From the Vite project directory, install the current Firebase SDK:

```bash
cd /Users/wuyuying/Documents/Github_Project/Coursework-Cornell-AAP-IT/react-practice
npm install firebase
```

Confirm that npm installed it:

```bash
npm list firebase
```

### Example code

After installation, Firebase modules can be imported with the modular API:

```js
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
```

### What this does

`npm install firebase` adds the official browser SDK to `dependencies` and updates `package-lock.json`. The modular imports allow Vite to omit Firebase features the app does not use.

## Step 7 — Create the Firebase initialization file

### In the Firebase Console

1. Open **Project settings** using the gear icon.
2. In **General**, scroll to **Your apps**.
3. Select `voxel-world-web`.
4. Under **SDK setup and configuration**, choose **Config**.
5. Copy each value into the `.env.local` file shown in Step 9.

### Local command

Create the folder and files with your editor. For example, from `react-practice/`:

```bash
mkdir -p src/lib
touch src/lib/firebase.js .env.local
```

### Example code

Add this to `src/lib/firebase.js`:

```js
import { getApp, getApps, initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredConfig = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId,
}

const missingKeys = Object.entries(requiredConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missingKeys.length > 0) {
  throw new Error(
    `Missing Firebase environment values: ${missingKeys.join(', ')}`,
  )
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
const db = getFirestore(app)

export { app, db }
```

### What this does

`initializeApp` connects the browser code to the registered Firebase project. `getFirestore` creates the Firestore client used by future save/load functions. The `getApps` check prevents development hot reloads from initializing Firebase twice, and the validation produces a clear error when required environment values are missing.

## Step 8 — Put the initialization file in the project structure

### In the Firebase Console

No console action is needed.

### Local command

Confirm that the expected files exist:

```bash
cd /Users/wuyuying/Documents/Github_Project/Coursework-Cornell-AAP-IT/react-practice
find src -maxdepth 2 -type f -name 'firebase.js'
```

### Example structure

Use this structure:

```text
react-practice/
├── .env.local
├── package.json
├── src/
│   ├── components/
│   │   └── Week3Scene.jsx
│   ├── lib/
│   │   └── firebase.js
│   ├── App.jsx
│   └── main.jsx
└── vite.config.js
```

### What this does

`src/lib/firebase.js` gives the application one shared place to initialize and export Firebase services. It keeps infrastructure code separate from `Week3Scene.jsx`, so connecting Firebase does not rewrite the voxel renderer or control logic.

## Step 9 — Add the Firebase configuration as Vite environment variables

### In the Firebase Console

Copy the values from **Project settings → General → Your apps → SDK setup and configuration → Config**.

### Local command

Before adding values, verify that the local environment file is ignored by Git:

```bash
cd /Users/wuyuying/Documents/Github_Project/Coursework-Cornell-AAP-IT/react-practice
git check-ignore .env.local
```

This repository already ignores `*.local`, so the command should print `.env.local`.

After editing `.env.local`, restart the Vite development server. Vite reads environment variables when it starts.

### Example code

Add the actual values from the console to `react-practice/.env.local`:

```dotenv
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket_from_the_console
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Do not add quotation marks unless a value actually requires them, and do not add spaces around `=`.

Important security notes:

- Vite exposes every `VITE_` variable to browser code. These values are configuration, not server secrets.
- Firebase's web API key identifies the project; it does not authorize Firestore access. Firebase documents these keys as public by design when used only with Firebase APIs.
- Protect the database with Firestore Security Rules and, before production, consider App Check.
- Never place a Firebase Admin SDK service-account JSON file, private key, password, or other server credential in `.env.local`, `src/`, or any `VITE_` variable.
- Use separate Firebase projects or separate environment files for development and production so a development build cannot accidentally write production data.

### What this does

Environment variables keep environment-specific configuration out of the source module and make it easier to switch Firebase projects. They do not make browser-visible Firebase configuration secret.

## Step 10 — Test the Firestore connection

This is a temporary connection test, not Save World or Load World functionality.

### In the Firebase Console

1. Open **Firestore Database → Data**.
2. Keep this page open while running the local test.
3. After the test succeeds, refresh the data view.
4. Confirm that a `connectionTests` collection contains a `browser` document.
5. Open the document and verify that `status` is `connected`.

If Firestore shows a permissions error, open **Firestore Database → Rules** and confirm that the temporary test-mode rules have not expired. Do not permanently solve the error by leaving the database open.

### Local command

Start the existing Vite app:

```bash
cd /Users/wuyuying/Documents/Github_Project/Coursework-Cornell-AAP-IT/react-practice
npm run dev
```

Open the local URL printed by Vite, then open the browser's developer console.

### Example code

Create a temporary file named `src/firebaseConnectionTest.js`:

```js
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './lib/firebase'

export async function testFirestoreConnection() {
  const testRef = doc(db, 'connectionTests', 'browser')

  await setDoc(testRef, {
    status: 'connected',
    checkedAt: serverTimestamp(),
  })

  const snapshot = await getDoc(testRef)

  if (!snapshot.exists()) {
    throw new Error('Firestore test document was not found after writing it.')
  }

  return snapshot.data()
}
```

Temporarily add this import near the top of `src/main.jsx`:

```js
import { testFirestoreConnection } from './firebaseConnectionTest'
```

Then add this block immediately before the existing `createRoot(...)` call:

```js
if (import.meta.env.DEV) {
  testFirestoreConnection()
    .then((data) => console.log('Firestore connection successful:', data))
    .catch((error) => console.error('Firestore connection failed:', error))
}
```

The complete temporary `src/main.jsx` should resemble:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { testFirestoreConnection } from './firebaseConnectionTest'

if (import.meta.env.DEV) {
  testFirestoreConnection()
    .then((data) => console.log('Firestore connection successful:', data))
    .catch((error) => console.error('Firestore connection failed:', error))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

### What this does

The test writes one small document and immediately reads it back. Success proves that:

- the SDK was installed;
- the environment variables loaded;
- Firebase initialized;
- the app reached the intended Firestore project;
- the current Security Rules allowed the request.

Expected browser-console output:

```text
Firestore connection successful: {status: 'connected', checkedAt: ...}
```

After verifying the result:

1. Remove the temporary import and test block from `src/main.jsx`.
2. Delete `src/firebaseConnectionTest.js`, or keep it outside the normal startup path for future diagnostics.
3. Delete the `connectionTests/browser` document in the Firebase Console if it is no longer useful.
4. Do not deploy while using open test-mode rules.
5. Run the existing checks:

```bash
npm run lint
npm run build
```

## Connection-stage completion checklist

- [ ] Firebase project created.
- [ ] Web app registered.
- [ ] Cloud Firestore Standard edition database created.
- [ ] Firebase SDK installed in `react-practice/`.
- [ ] `.env.local` populated and ignored by Git.
- [ ] `src/lib/firebase.js` created.
- [ ] Temporary write/read test succeeded.
- [ ] Test document appeared in the Firestore Console.
- [ ] Temporary startup test code removed.
- [ ] Production deployment postponed until Authentication and restrictive Security Rules are designed.
- [ ] No raw voxel arrays or mesh geometry were uploaded.

## Next stage—not part of this tutorial

Only after this checklist passes should the project design:

1. a versioned `worlds` document schema;
2. serialization of the current Week 3 parameter state;
3. ordered CSG-operation validation;
4. Save World and Load World functions;
5. Authentication and owner-based Security Rules;
6. optional performance-experiment documents;
7. local regeneration of voxels and meshes from the loaded parameters.
