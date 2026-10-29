# Skill Swap — Firestore Schema (MS1: System Foundation)

## Collections overview

```
users/{userId}
skills/{skillId}
swapRequests/{requestId}
categoryRequests/{requestId}
reviews/{reviewId}
notifications/{notificationId}
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
| `status` | `"active"` \| `"suspended"` | defaults to `"active"`; only admins can suspend or reactivate users |
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

Members create and manage their own skill listings. Admins can pause, remove, and restore listings from `/admin`, but cannot create or swap skills. Removed listings are soft-moderated by changing `status` to `"removed"`; their documents are retained.

---

## `swapRequests/{requestId}`
Auto-ID document. Represents one user requesting a swap tied to a specific skill listing.

| Field | Type | Notes |
|---|---|---|
| `fromUserId` | string | requester |
| `toUserId` | string | skill owner |
| `skillId` | string | the `skills/{skillId}` being requested |
| `offeredSkillId` | string \| null | the active skill listing the recipient selects from the requester when accepting |
| `message` | string | optional note from requester |
| `status` | `"pending"` \| `"accepted"` \| `"declined"` \| `"cancelled"` \| `"completed"` | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | bumped on every status change; drive real-time UI (Sprint 3) off this |

**Indexes needed:** `toUserId + status + createdAt`, `fromUserId + status + createdAt`.

The dashboard creates requests from active skill listings. A request starts as `pending`; only the recipient can change it to `accepted` or `declined`, and only the sender can change it to `cancelled`. To accept, the recipient must select an active skill listing owned by the requester; its ID is stored in `offeredSkillId`. Status changes update `updatedAt`; participant IDs and the requested skill cannot be changed after creation.

Admins can read swap request records for platform analytics; only participants can create or change requests. User analytics are derived from that member's own listings and incoming/outgoing requests. The current dashboards aggregate client-readable records and are intended for the current MVP data volume.

---

## `notifications/{notificationId}`
Auto-ID document. Created atomically with the related swap request or decision.

| Field | Type | Notes |
|---|---|---|
| `recipientId` | string | user who receives the notification |
| `actorId` | string | user who initiated the request or decision |
| `requestId` | string | related swap or category request document |
| `kind` | `"swap_request"` \| `"swap_accepted"` \| `"swap_declined"` \| `"category_request"` | event represented by this notification |
| `read` | boolean | recipients can mark their notifications as read |
| `createdAt` | timestamp | server timestamp |

Notifications stream live in the dashboard. Recipients can mark one notification read by opening it, or mark all as read. Category request notifications are delivered to active admin accounts and open the admin review panel.

---

## `categoryRequests/{requestId}`
Auto-ID document. A member's request to add a skill category.

| Field | Type | Notes |
|---|---|---|
| `requesterId` | string | references `users/{uid}` |
| `requesterName` | string | denormalized for admin review |
| `name` | string | requested category name (2–40 characters) |
| `reason` | string | optional explanation (up to 500 characters) |
| `status` | `"pending"` \| `"approved"` \| `"declined"` | admins review requests from `/admin` |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

Members can read their own requests and approved categories. Approving a request adds its category to discovery filters and listing forms.

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
