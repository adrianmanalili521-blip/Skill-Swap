import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";

initializeApp();
const db = getFirestore();

export const countNewSwapRequest = onDocumentCreated(
  { document: "swapRequests/{requestId}", retry: true },
  async (event) => {
  const request = event.data?.data();
  const requestId = event.params.requestId;
  if (!request || typeof request.skillId !== "string"
    || typeof request.fromUserId !== "string" || typeof request.toUserId !== "string") {
    logger.error("Swap request is missing fields required for counter updates.", { requestId });
    return;
  }

  const marker = db.doc(`swapRequestMetrics/${requestId}`);
  const skill = db.doc(`skills/${request.skillId}`);
  const requester = db.doc(`users/${request.fromUserId}`);
  const owner = db.doc(`users/${request.toUserId}`);
  let skillMissing = false;
  await db.runTransaction(async (transaction) => {
    const [markerSnapshot, skillSnapshot, requesterSnapshot, ownerSnapshot] =
      await transaction.getAll(marker, skill, requester, owner);
    if (markerSnapshot.exists) return;
    transaction.create(marker, { createdAt: FieldValue.serverTimestamp() });
    if (skillSnapshot.exists) {
      transaction.update(skill, {
        requestCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      skillMissing = true;
    }
    if (requesterSnapshot.exists) {
      transaction.update(requester, { sentRequestCount: FieldValue.increment(1) });
    }
    if (ownerSnapshot.exists) {
      transaction.update(owner, { receivedRequestCount: FieldValue.increment(1) });
    }
  });
  if (skillMissing) logger.warn("Request counters updated, but the requested skill had already been deleted.", { requestId });
});

export const countCompletedExchange = onDocumentUpdated(
  { document: "swapRequests/{requestId}", retry: true },
  async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const requestId = event.params.requestId;
  if (!before || !after || before.status === "completed" || after.status !== "completed"
    || typeof after.fromUserId !== "string" || typeof after.toUserId !== "string") return;

  const marker = db.doc(`completedExchangeMetrics/${requestId}`);
  const requester = db.doc(`users/${after.fromUserId}`);
  const owner = db.doc(`users/${after.toUserId}`);
  await db.runTransaction(async (transaction) => {
    const [markerSnapshot, requesterSnapshot, ownerSnapshot] =
      await transaction.getAll(marker, requester, owner);
    if (markerSnapshot.exists) return;
    transaction.create(marker, { createdAt: FieldValue.serverTimestamp() });
    if (requesterSnapshot.exists) {
      transaction.update(requester, { completedExchangeCount: FieldValue.increment(1) });
    } else {
      logger.error("Completed-exchange requester profile is missing.", { requestId, uid: after.fromUserId });
    }
    if (ownerSnapshot.exists) {
      transaction.update(owner, { completedExchangeCount: FieldValue.increment(1) });
    } else {
      logger.error("Completed-exchange recipient profile is missing.", { requestId, uid: after.toUserId });
    }
  });
});

export const aggregateReviewRating = onDocumentCreated(
  { document: "reviews/{reviewId}", retry: true },
  async (event) => {
  const review = event.data?.data();
  const reviewId = event.params.reviewId;
  if (!review || typeof review.targetUserId !== "string" || typeof review.rating !== "number") {
    logger.error("Review is missing fields required for rating aggregation.", { reviewId });
    return;
  }

  const marker = db.doc(`reviewMetrics/${reviewId}`);
  const target = db.doc(`users/${review.targetUserId}`);
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(marker)).exists) return;
    const targetSnapshot = await transaction.get(target);
    if (!targetSnapshot.exists) {
      logger.error("Review target profile is missing; the rating cannot be aggregated.", { reviewId });
      transaction.create(marker, { skipped: true, createdAt: FieldValue.serverTimestamp() });
      return;
    }
    const currentRating = Number(targetSnapshot.get("rating") ?? 0);
    const currentCount = Number(targetSnapshot.get("ratingCount") ?? 0);
    const ratingCount = currentCount + 1;
    const rating = (currentRating * currentCount + review.rating) / ratingCount;
    transaction.create(marker, { createdAt: FieldValue.serverTimestamp() });
    transaction.update(target, { rating, ratingCount });
  });
});
