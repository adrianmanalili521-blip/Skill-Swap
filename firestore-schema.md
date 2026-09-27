# Skill Swap — Firestore Schema (MS1: System Foundation)

## Collections overview

```
users/{userId}
skills/{skillId}
swapRequests/{requestId}
reviews/{reviewId}
```

---

## `users/{userId}`
Document ID = Firebase Auth `uid` (keeps 1:1 lookup trivial, no extra query needed).

| Field | Type | Notes |
|---|---|---|
| `uid` | string | duplicate of doc ID, useful in queries/rules |
| `displayName` | string | |
| `email` | string | |
| `photoURL` | string \| null | |
| `bio` | string | |
| `skillsOffered` | array\<string\> | denormalized skill titles/IDs for quick profile display |
| `learningGoals` | array\<string\> | skills the user wants to learn |
| `role` | `"user"` \| `"admin"` | default `"user"`; only settable by admin via rules |
| `rating` | number | running average, updated via Cloud Function on new review (Sprint 3+) |
| `ratingCount` | number | |
| `theme` | `"light"` \| `"dark"` | optional, persists MS2 theme toggle per-user |
| `createdAt` | timestamp | server timestamp |
| `updatedAt` | timestamp | server timestamp |

---

## `skills/{skillId}`
Auto-ID document. One doc per skill listing a user offers.

| Field | Type | Notes |
|---|---|---|
| `ownerId` | string | references `users/{uid}` |
| `ownerName` | string | denormalized for feed rendering without extra reads |
| `title` | string | e.g. "Conversational Spanish" |
| `description` | string | |
| `category` | string | e.g. "Language", "Design", "Coding", "Music" |
| `level` | `"beginner"` \| `"intermediate"` \| `"advanced"` | |
| `tags` | array\<string\> | for search/filter |
| `status` | `"active"` \| `"paused"` \| `"removed"` | admin moderation flips to `"removed"` |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**Indexes needed:** `category + createdAt`, `status + createdAt` (see `firestore.indexes.json`).

---

## `swapRequests/{requestId}`
Auto-ID document. Represents one user requesting a swap tied to a specific skill listing.

| Field | Type | Notes |
|---|---|---|
| `fromUserId` | string | requester |
| `toUserId` | string | skill owner |
| `skillId` | string | the `skills/{skillId}` being requested |
| `offeredSkillId` | string \| null | optional — what the requester offers in exchange |
| `message` | string | optional note from requester |
| `status` | `"pending"` \| `"accepted"` \| `"declined"` \| `"cancelled"` \| `"completed"` | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | bumped on every status change; drive real-time UI (Sprint 3) off this |

**Indexes needed:** `toUserId + status + createdAt`, `fromUserId + status + createdAt`.

---

## `reviews/{reviewId}` (optional, supports post-swap trust signals)

| Field | Type | Notes |
|---|---|---|
| `swapRequestId` | string | the completed swap this review is for |
| `authorId` | string | reviewer |
| `targetUserId` | string | who's being reviewed |
| `rating` | number | 1–5 |
| `comment` | string | |
| `createdAt` | timestamp | |

---

## Design notes

- **Denormalization**: `ownerName` on `skills` and `skillsOffered` on `users` trade a bit of write-time duplication for cheap reads on the discovery feed and profile pages — important since Firestore charges per document read.
- **Status enums as strings** (not booleans) on `skills` and `swapRequests` leave room to add states later (e.g. `"expired"`) without a schema migration.
- **No nested subcollections yet** — flat top-level collections keep the security rules and initial queries simple. If review volume grows, consider moving `reviews` under `users/{userId}/reviews` in a later sprint.
- **Server timestamps**: always write `createdAt`/`updatedAt` with `serverTimestamp()`, never client `Date.now()`, so ordering is consistent regardless of client clocks.

## Next steps (rest of Sprint 1)
1. `firebase init` in your Next.js repo root → select Firestore + Hosting, point it at this `firebase.json`.
2. `firebase deploy --only firestore:rules,firestore:indexes` once you've reviewed `firestore.rules`.
3. Drop `.env.local.example` → copy to `.env.local`, fill in values from Firebase Console → Project Settings.
4. Wire up `lib/firebase.ts` and move on to Firebase Authentication (Email/Password + OAuth) for the rest of MS2.
