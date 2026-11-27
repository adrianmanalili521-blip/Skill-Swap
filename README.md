# Skill Swap

Skill Swap is a cashless community marketplace where people share what they can teach and find skills they want to learn.

## Current Features

- Firebase Authentication with email/password and Google sign-in.
- Authenticated landing page at `/dashboard`; signed-out users are redirected to sign-in.
- Editable member profiles with bios, skill tags, and learning goals.
- Public member profile pages linked from skill listings.
- Skill listing creation, editing, pausing, resuming, and deletion.
- Skill discovery with keyword and category filters.
- Sorted 12-item discovery pages, including popularity sorting based on trusted request counters.
- Swap requests from discovery listings, with received/sent request views and accept, decline, and cancel actions. Recipients select one of the requester's active listings when accepting.
- Exchange scheduling and participant-only real-time chat after a request is accepted.
- Exchange completion and one immutable 1–5 star review per participant, with trusted aggregate ratings.
- Private JPEG, PNG, and PDF identity-document upload with administrator review, audit logging, and evidence deletion after review.
- Community member rankings based on completed exchanges and review rating.
- Real-time in-app notifications for new swap requests and accepted or declined requests, with unread counts and read controls.
- Personal analytics for members and platform activity analytics for admins, including six-month trends and category breakdowns.
- A protected admin workspace with user suspension and role management, skill-listing moderation, pending swap cancellation, custom category management, member reports, notifications, CSV analytics, and append-only administrative audit logs.
- Light/dark mode with per-device and per-account preference persistence.
- User profile documents stored at `users/{uid}` in Cloud Firestore.
- Firestore rules and composite indexes defined in `firestore.rules` and `firestore.indexes.json`.
- Firebase Storage rules in `storage.rules` and trusted counter/rating triggers in `functions/`.

The profile's `skillsOffered` and `learningGoals` fields are arrays edited as comma-separated text. They are profile tags, separate from full skill listing records.

## Prerequisites

- Node.js and npm (Node.js 22 for the Cloud Functions package).
- A Firebase project with a Web app registered.
- Firebase Authentication providers enabled for the sign-in methods you plan to use.
- A default Cloud Firestore database created in the same project.
- Firebase Storage enabled for the project.
- A Firebase billing plan that supports Cloud Functions v2.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   npm --prefix functions install
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

6. Log in to Firebase CLI and deploy Firestore rules/indexes, Storage rules, and Cloud Functions:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage,functions
   ```

   Wait for any new composite indexes to finish building before testing queries that need them.

7. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

8. Configure Storage CORS to allow the app's origin if administrators cannot securely download evidence via Firebase Storage's authenticated `getBlob` API. Identity documents are never given public download URLs.

   Existing users, skills, swaps, and reports need no migration. Existing users may lack the new backend-managed counters; backfill those fields from trusted historical data before treating the leaderboard as complete. On the admin Categories page, use **Import legacy** to backfill existing approved category requests into the managed category catalog; new approvals create catalog entries automatically.

## Authentication and Dashboard Flow

- New users register from `/` with a display name, email, and password, or use Google sign-in.
- On successful authentication, the app ensures a matching `users/{uid}` Firestore document exists, then routes to `/dashboard`.
- The dashboard provides discovery, listing management, swap requests, and profile views. Discovery filters active listings by keyword or category and supports sorting and 12-item pages. Users can request a swap from a listing, view requests they sent or received, accept/decline incoming requests, and cancel pending outgoing requests. Accepted swaps support one-time date/time proposals with online or onsite details and private chat; either participant can mark completion and submit one review. Users can edit their bio, skill tags, and learning goals; the display name and email come from Firebase Authentication.
- Identity documents are held in a private Storage path, readable only by the owner and an active admin. Administrators decide from `/admin` and the app deletes the evidence after review. Configure and publish the Storage rules before enabling uploads. Establish your retention and privacy policy before production use.
- Listing owners can create, edit, pause, resume, and delete their skill listings. Selecting an owner opens their public profile.
- Theme preference is stored locally and, when signed in, synced to `users/{uid}.theme`.
- Direct visits to `/admin` are verified by a server route using the Firebase ID token and signed-in user's Firestore role; Firestore Security Rules separately enforce authorization for every privileged read and write.
- The first administrator must be bootstrapped by a trusted project owner in Firebase Console by setting `users/{uid}.role` to `admin` and `status` to `active`. Other active administrators can grant or remove administrator roles for other accounts; those changes are logged.
- Member reports are available from public member profiles and skill discovery cards. Reports, custom categories, and administrator actions use the `reports`, `categories`, and `adminActivityLogs` collections documented in `firestore-schema.md`.
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
- `storage.rules` — private identity-document access and upload restrictions.
- `functions/src/index.ts` — idempotent request, exchange, and rating aggregates.

## Development Checks

```bash
npm run lint
npm run build
```

The repository-wide lint command currently reports existing issues in `lib/firebase.ts` (CommonJS `require`) and `lib/theme-context.tsx` (synchronous state updates in an effect). Changed application and function source files can be checked with `npx eslint app/dashboard/sprint-two-workspace.tsx app/dashboard/enhancement-panels.tsx app/admin/admin-dashboard.tsx 'app/profile/[userId]/page.tsx' lib/auth-context.tsx functions/src/index.ts`.