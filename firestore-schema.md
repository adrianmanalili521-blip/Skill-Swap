# Skill Swap — Firestore Schema (MS1: System Foundation)

## Collections overview

```
users/{userId}
skills/{skillId}
swapRequests/{requestId}
categoryRequests/{requestId}
reviews/{reviewId}
notifications/{notificationId}
categories/{categoryId}
reports/{reportId}
adminActivityLogs/{logId}
idVerifications/{userId}
swapRequests/{requestId}/messages/{messageId}
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
| `rating` | number | running average, updated by a trusted Cloud Function |
| `ratingCount` | number | number of accepted reviews; backend-managed |
| `completedExchangeCount` | number | completed swaps; backend-managed and used for member rankings |
| `sentRequestCount` | number | lifetime outgoing request count; backend-managed |
| `receivedRequestCount` | number | lifetime incoming request count; backend-managed |
| `verified` | boolean | identity reviewed by an administrator; only an admin can change it |
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
| `durationMinutes` | integer (15–480) | Length of one listing's session; legacy listings default to 60 minutes |
| `price` | number \| null | Optional informational amount in PHP; must be at least 0; null means not set |
| `priceCurrency` | `"PHP"` | Platform currency for any displayed listing price; no payment is processed |
| `requestCount` | number | lifetime request count, incremented by a trusted Cloud Function |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**Indexes needed:** `category + createdAt`, `status + createdAt` (see `firestore.indexes.json`). Discovery supports client-side keyword filtering, sorting, and 12-item pages over currently loaded active listings.

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
| `durationMinutes` | integer | Sum of the requested and offered listing durations at acceptance; legacy accepted swaps default to 120 minutes |
| `message` | string | optional note from requester |
| `status` | `"pending"` \| `"accepted"` \| `"declined"` \| `"cancelled"` \| `"completed"` | |
| `scheduledAt` | timestamp \| null | confirmed exchange date/time; null until a proposed time is confirmed |
| `scheduleDurationMinutes` | integer | Fixed length of the combined session |
| `scheduleStatus` | `"proposed"` \| `"selected"` \| `"confirmed"` | new proposals move directly from `proposed` to `confirmed`; `selected` is retained for existing swaps |
| `scheduleProposerId` | string \| null | participant who proposed the current time |
| `scheduleOptions` | list\<timestamp\> | One-time future time proposals; new proposals contain one time |
| `scheduleSelectedIndex` | integer \| null | proposed time confirmed by the other participant |
| `scheduleTimeZone` | string | IANA timezone used when the time was proposed |
| `scheduleMode` | `"online"` \| `"onsite"` | format selected by the participant proposing times |
| `schedulePlatform` | string | online meeting platform, up to 80 characters |
| `scheduleVenue` | string | onsite venue or meeting place, up to 240 characters |
| `scheduleNote` | string | optional online meeting link or joining details, up to 240 characters |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | bumped on every status change; drive real-time UI (Sprint 3) off this |

**Indexes needed:** `toUserId + status + createdAt`, `fromUserId + status + createdAt`.

The dashboard creates requests from active skill listings. A request starts as `pending`; only the recipient can change it to `accepted` or `declined`, and only the sender can change it to `cancelled`. To accept, the recipient must select an active skill listing owned by the requester; its ID is stored in `offeredSkillId`. Status changes update `updatedAt`; participant IDs and the requested skill cannot be changed after creation.

Admins can read swap request records for platform analytics; only participants can create or change requests. User analytics are derived from that member's own listings and incoming/outgoing requests. The current dashboards aggregate client-readable records and are intended for the current MVP data volume.

After acceptance, either participant can propose one specific future date and time, choosing online (platform and optional joining details) or onsite (venue). The other participant confirms the proposed time directly or discusses another time in chat. Recurring availability is never shared. Either participant can propose a new time to reschedule. The confirmed time, duration, and meeting details are visible to both participants in the exchange workspace and swap request cards. Listing prices are informational only; payment processing is not included. Both participants can also send messages in the request's `messages` subcollection, and either may mark the exchange completed. Administrators may cancel pending requests for safety or moderation, but cannot accept, decline, or complete exchanges on behalf of participants. Every admin cancellation is written to `adminActivityLogs` in the same Firestore batch.

### `swapRequests/{requestId}/messages/{messageId}`

Private chat messages for accepted or completed exchanges. Each message contains `senderId`, `text` (1–2,000 characters), and server-generated `createdAt`. Only active exchange participants can read/create messages; they cannot edit or delete them. The dashboard streams the newest 100 messages in chronological order.

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

An approved request also creates a matching `categories/{categoryId}` record so administrators can describe, deactivate, or safely remove custom categories. Existing approved requests remain the historical source for already-approved categories; when such a category is deactivated, the category record suppresses it from member filters without deleting the request history.

The admin Categories page offers a batched, audited import action for approved requests created before the `categories` collection existed.

---

## `categories/{categoryId}` (admin-managed custom categories)

The document ID is a normalized lowercase category name (for example `art-history`). Built-in member categories remain in the application and are not duplicated in this collection.

| Field | Type | Notes |
|---|---|---|
| `name` | string | 2–40 characters |
| `description` | string | optional, up to 300 characters |
| `status` | `"active"` \| `"inactive"` | inactive categories are hidden from member category filters |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

Admins can create, edit, activate, deactivate, and remove custom categories. Removal is blocked while any skill listing uses the category. Renaming a custom category updates its listing category values atomically, subject to Firestore's 500-write batch limit. Approved category-request names are retained as history; those categories can be deactivated but not renamed or deleted.

---

## `reports/{reportId}` (member-submitted moderation reports)

| Field | Type | Notes |
|---|---|---|
| `reporterId` | string | authenticated member |
| `reporterName` | string | display name snapshot |
| `targetType` | `"user"` \| `"listing"` | |
| `targetId` | string | target document ID |
| `reason` | string | 10–1,000 characters |
| `status` | `"pending"` \| `"under_review"` \| `"resolved"` \| `"dismissed"` | starts as `pending` |
| `resolutionNote` | string | optional moderator decision, up to 500 characters |
| `moderatorId` | string | administrator who made the latest decision |
| `moderatorName` | string | display name snapshot |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

Members may create reports about another member or listing but cannot read or modify reports. Only active administrators can read reports and change moderation status.

---

## `adminActivityLogs/{logId}` (append-only admin audit trail)

| Field | Type | Notes |
|---|---|---|
| `actorId` | string | authenticated administrator UID |
| `actorName` | string | display name snapshot |
| `action` | string | action identifier |
| `entityType` | string | affected record type |
| `entityId` | string | affected document ID |
| `summary` | string | concise human-readable action |
| `before` | map \| null | prior values for changed fields |
| `after` | map \| null | new values for changed fields |
| `createdAt` | timestamp | server timestamp |

Only active admins can read or create log entries. Firestore rules deny updates and deletes. The UI writes each log in the same batch as the corresponding moderation operation.

---

## `reviews/{reviewId}` (post-swap trust signals)

| Field | Type | Notes |
|---|---|---|
| `swapRequestId` | string | the completed swap this review is for |
| `authorId` | string | reviewer |
| `targetUserId` | string | who's being reviewed |
| `rating` | number | 1–5 |
| `comment` | string | optional, up to 500 characters |
| `createdAt` | timestamp | |

The document ID is `${swapRequestId}_${authorId}`, allowing one immutable review per exchange participant. Rules require a completed exchange and participant-to-participant target. A Cloud Function maintains the reviewed member's average and count.

---

## `idVerifications/{userId}` (private identity review)

One record per user. Contains `userId`, private `storagePath`, sanitized `documentName`, MIME type, byte size, `status` (`pending`, `approved`, `rejected`), `storageDeleted`, optional administrator `reviewNote`, reviewer identity/timestamps, and creation/update timestamps. Only the owner and active administrators can read it. Owners can submit JPEG, PNG, or PDF files up to 10 MiB and resubmit after rejection. Administrators approve/reject with an audit log and the app deletes the evidence from Storage after review; a failed deletion is shown in the admin panel and can be retried. The public user profile contains only the `verified` boolean; it never exposes document metadata or files.

Evidence objects use `identityDocuments/{userId}/{randomFileId}`. Storage rules deny public access, restrict upload type and size, and permit reads only by the owner or an active administrator. Configure Firebase Storage CORS for the app's origin if browser `getBlob` downloads are blocked.

---

## Backend-maintained counters

Cloud Functions v2 keep `skills.requestCount`, user `sentRequestCount` / `receivedRequestCount`, `completedExchangeCount`, and review `rating` / `ratingCount` synchronized. Private idempotency markers in `swapRequestMetrics`, `completedExchangeMetrics`, and `reviewMetrics` prevent duplicate event delivery from double-counting. Client rules deny writes to these metrics and protected user/listing counters. The `users` ranking query uses `completedExchangeCount` and `rating`; existing installations should backfill missing counter fields before relying on a complete ranking.

Cloud Functions require a Firebase project with billing enabled. Deploy functions and rules together so client writes and trusted aggregates stay consistent.

---

## Design notes

- **Denormalization**: `ownerName` on `skills` and `skillsOffered` on `users` trade a bit of write-time duplication for cheap reads on the discovery feed and profile pages — important since Firestore charges per document read.
- **Status enums as strings** (not booleans) on `skills` and `swapRequests` leave room to add states later (e.g. `"expired"`) without a schema migration.
- Admin role decisions are based on the trusted `users/{uid}.role` and `status` fields. Admin role changes are limited to active admins, cannot target the acting admin, and are audited. Bootstrap the first admin out of band in Firebase Console.
- `reports`, `categories`, and `adminActivityLogs` are additive collections; existing user, skill, swap, and category-request documents need no migration.
- **Server timestamps**: always write `createdAt`/`updatedAt` with `serverTimestamp()`, never client `Date.now()`, so ordering is consistent regardless of client clocks.

## Next steps (rest of Sprint 1)
1. `firebase init` in your Next.js repo root → select Firestore + Hosting, point it at this `firebase.json`.
2. `firebase deploy --only firestore:rules,firestore:indexes` once you've reviewed `firestore.rules`.
3. Drop `.env.local.example` → copy to `.env.local`, fill in values from Firebase Console → Project Settings.
4. Wire up `lib/firebase.ts` and move on to Firebase Authentication (Email/Password + OAuth) for the rest of MS2.
