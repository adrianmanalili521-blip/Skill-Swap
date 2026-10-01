# Skill Swap

Skill Swap is a cashless community marketplace where people share what they can teach and find skills they want to learn.

## Current Features

- Firebase Authentication with email/password and Google sign-in.
- Authenticated landing page at `/dashboard`; signed-out users are redirected to sign-in.
- Profile summary and editing for bio, skills offered, and learning goals.
- User profile documents stored at `users/{uid}` in Cloud Firestore.
- Firestore rules and composite indexes defined in `firestore.rules` and `firestore.indexes.json`.

The profile's `skillsOffered` and `learningGoals` fields are arrays edited as comma-separated text. They are profile tags, not full skill listing records. Listing CRUD, discovery/search, theme persistence, swap requests, real-time updates, and the admin panel are not implemented yet.

## Prerequisites

- Node.js and npm.
- A Firebase project with a Web app registered.
- Firebase Authentication providers enabled for the sign-in methods you plan to use.
- A default Cloud Firestore database created in the same project.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` in the repository root with the Firebase Web app configuration:

   ```dotenv
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
   ```

   Copy values from Firebase Console → Project settings → General → Your apps. Use the values only, not the surrounding JavaScript object syntax, quotes, or commas. Do not commit `.env.local`. These are Firebase Web app settings, not service-account credentials.

3. Ensure the Firebase CLI project in `.firebaserc` is the same project used by `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.

4. In Firebase Console, enable Email/Password and, if desired, Google under Authentication → Sign-in method. For local Google sign-in, authorize `localhost` in Authentication settings.

5. Create the `(default)` Firestore database. `firebase.json` specifies `nam5` (United States multi-region) for database creation. Firestore database location cannot be changed after creation.

6. Log in to Firebase CLI and deploy rules and indexes:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules,firestore:indexes
   ```

   Wait for any new composite indexes to finish building before testing queries that need them.

7. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Authentication and Dashboard Flow

- New users register from `/` with a display name, email, and password, or use Google sign-in.
- On successful authentication, the app ensures a matching `users/{uid}` Firestore document exists, then routes to `/dashboard`.
- The dashboard loads the user's profile. Users can edit their bio, skills offered, and learning goals; the display name and email come from Firebase Authentication.
- Signing out returns the user to `/`. Direct visits to `/dashboard` require an authenticated Firebase user.

If signup succeeds but the profile write fails, the Auth account may still exist. Try signing in with that account after Firestore is available rather than registering again.

## Project Layout

- `app/page.tsx` — sign-in and registration screen.
- `app/dashboard/page.tsx` — authenticated dashboard and profile editor.
- `lib/auth-context.tsx` — Firebase Auth context and initial user profile creation.
- `lib/firebase.ts` — Firebase client initialization.
- `lib/auth-errors.ts` — user-facing Firebase error messages.
- `firestore-schema.md` — planned Firestore collections and fields.
- `firestore.rules` — Firestore access rules.
- `firestore.indexes.json` — composite indexes for planned queries.

## Development Checks

```bash
npm run lint
npm run build
```

The lint command currently reports a `require()` style error in the server-side Firestore fallback in `lib/firebase.ts`; the dashboard files can be checked separately with `npx eslint app/page.tsx app/dashboard/page.tsx`.