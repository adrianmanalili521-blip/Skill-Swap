"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db, storage } from "@/lib/firebase";

interface ExchangeRecord {
  id: string;
  status: "accepted" | "completed";
  scheduledAt?: Timestamp | null;
  scheduleTimeZone?: string;
  scheduleNote?: string;
}

interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt?: Timestamp;
}

interface VerificationRecord {
  status: "pending" | "approved" | "rejected";
  storagePath: string;
  documentName: string;
  reviewNote?: string;
}

interface RankedMember {
  id: string;
  displayName?: string;
  rating?: number;
  ratingCount?: number;
  completedExchangeCount?: number;
}

function localDateTime(value?: Timestamp | null) {
  if (!value) return "";
  const date = value.toDate();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function displayDate(value?: Timestamp) {
  return value?.toDate().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }) ?? "Sending…";
}

export function ExchangeWorkspace({
  requestId,
  currentUserId,
  otherUserId,
  requestStatus,
}: {
  requestId: string;
  currentUserId: string;
  otherUserId: string;
  requestStatus: string;
}) {
  const [record, setRecord] = useState<ExchangeRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState("");
  const [hasReviewed, setHasReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    doc(db, "swapRequests", requestId),
    (snapshot) => {
      if (!snapshot.exists()) {
        setError("This exchange is no longer available.");
        return;
      }
      const next = { id: snapshot.id, ...snapshot.data() } as ExchangeRecord;
      setRecord(next);
      setScheduledAt(localDateTime(next.scheduledAt));
      setScheduleNote(next.scheduleNote ?? "");
    },
    (snapshotError) => setError(`Unable to load exchange details: ${getAuthErrorMessage(snapshotError)}`),
  ), [requestId]);

  useEffect(() => {
    if (requestStatus !== "accepted" && requestStatus !== "completed") return;
    return onSnapshot(
      query(collection(db, "swapRequests", requestId, "messages"), orderBy("createdAt", "desc"), limit(100)),
      (snapshot) => setMessages([...snapshot.docs].reverse().map((item) => ({
        id: item.id,
        ...item.data(),
      }) as ChatMessage)),
      (snapshotError) => setError(`Unable to load exchange chat: ${getAuthErrorMessage(snapshotError)}`),
    );
  }, [requestId, requestStatus]);

  useEffect(() => {
    if (requestStatus !== "completed") return;
    let active = true;
    void getDoc(doc(db, "reviews", `${requestId}_${currentUserId}`))
      .then((snapshot) => { if (active) setHasReviewed(snapshot.exists()); })
      .catch((snapshotError: unknown) => {
        if (active) setError(`Unable to check your review: ${getAuthErrorMessage(snapshotError)}`);
      });
    return () => { active = false; };
  }, [currentUserId, requestId, requestStatus]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, "swapRequests", requestId, "messages"), {
        senderId: currentUserId,
        text,
        createdAt: serverTimestamp(),
      });
      setMessage("");
    } catch (sendError) {
      setError(getAuthErrorMessage(sendError));
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || !scheduledAt || busy) return;
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      setError("Choose a date and time in the future.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, "swapRequests", requestId), {
        scheduledAt: Timestamp.fromDate(date),
        scheduleTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        scheduleNote: scheduleNote.trim(),
        updatedAt: serverTimestamp(),
      });
      setNotice("Exchange time saved.");
    } catch (saveError) {
      setError(getAuthErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function markComplete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, "swapRequests", requestId), {
        status: "completed",
        updatedAt: serverTimestamp(),
      });
      setNotice("Exchange marked complete. You can now leave a review.");
    } catch (completeError) {
      setError(getAuthErrorMessage(completeError));
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || hasReviewed) return;
    setBusy(true);
    setError(null);
    try {
      await setDoc(doc(db, "reviews", `${requestId}_${currentUserId}`), {
        swapRequestId: requestId,
        authorId: currentUserId,
        targetUserId: otherUserId,
        rating,
        comment: review.trim(),
        createdAt: serverTimestamp(),
      });
      setHasReviewed(true);
      setNotice("Your review was submitted.");
    } catch (reviewError) {
      setError(getAuthErrorMessage(reviewError));
    } finally {
      setBusy(false);
    }
  }

  if (requestStatus !== "accepted" && requestStatus !== "completed") return null;

  return <section className="exchange-workspace" aria-label="Exchange schedule and chat">
    {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
    {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}
    <div className="exchange-tools-grid">
      <form className="exchange-tool-card" onSubmit={(event) => void saveSchedule(event)}>
        <h4>Schedule this exchange</h4>
        <label className="dashboard-field"><span>Date and time</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required disabled={requestStatus === "completed"} /></label>
        <label className="dashboard-field"><span>Location or meeting details <small>Optional</small></span><input value={scheduleNote} onChange={(event) => setScheduleNote(event.target.value)} maxLength={240} placeholder="Share a meeting place or call details" disabled={requestStatus === "completed"} /></label>
        {record?.scheduledAt && <p className="exchange-schedule-current">Agreed time: {record.scheduledAt.toDate().toLocaleString(undefined, { timeZone: record.scheduleTimeZone || undefined })} {record.scheduleTimeZone ? `(${record.scheduleTimeZone})` : ""}</p>}
        {requestStatus === "accepted" && <button className="secondary-action" type="submit" disabled={busy}>{busy ? "Saving..." : "Save schedule"}</button>}
      </form>
      <section className="exchange-tool-card" aria-label="Private exchange chat">
        <h4>Exchange chat</h4>
        <div className="exchange-message-list" aria-live="polite">
          {messages.length ? messages.map((item) => <p className={item.senderId === currentUserId ? "exchange-message mine" : "exchange-message"} key={item.id}>
            <span>{item.text}</span><small>{item.senderId === currentUserId ? "You" : "Partner"} · {displayDate(item.createdAt)}</small>
          </p>) : <p className="exchange-chat-empty">Use this private chat to coordinate your exchange.</p>}
        </div>
        <form className="exchange-chat-form" onSubmit={(event) => void sendMessage(event)}>
          <label className="visually-hidden" htmlFor={`message-${requestId}`}>Message your exchange partner</label>
          <input id={`message-${requestId}`} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} placeholder="Write a message" required />
          <button className="primary-action" type="submit" disabled={busy || !message.trim()}>Send</button>
        </form>
      </section>
    </div>
    {requestStatus === "accepted" && <button className="secondary-action exchange-complete-button" type="button" onClick={() => void markComplete()} disabled={busy}>Mark exchange complete</button>}
    {requestStatus === "completed" && (hasReviewed
      ? <p className="exchange-chat-empty">You’ve reviewed this exchange. Thank you!</p>
      : <form className="exchange-review-form" onSubmit={(event) => void submitReview(event)}>
        <h4>Rate your exchange</h4>
        <label className="dashboard-field"><span>Rating</span><select value={rating} onChange={(event) => setRating(Number(event.target.value))}><option value={5}>5 — Excellent</option><option value={4}>4 — Great</option><option value={3}>3 — Good</option><option value={2}>2 — Fair</option><option value={1}>1 — Poor</option></select></label>
        <label className="dashboard-field"><span>Comment <small>Optional · 500 characters max</small></span><textarea value={review} onChange={(event) => setReview(event.target.value)} maxLength={500} rows={2} /></label>
        <button className="primary-action" type="submit" disabled={busy}>{busy ? "Submitting..." : "Submit review"}</button>
      </form>)}
  </section>;
}

export function CommunityRankings() {
  const [members, setMembers] = useState<RankedMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(
      collection(db, "users"),
      where("status", "==", "active"),
      where("role", "==", "user"),
      orderBy("completedExchangeCount", "desc"),
      orderBy("rating", "desc"),
      limit(10),
    ),
    (snapshot) => {
      setMembers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as RankedMember));
      setError(null);
    },
    (snapshotError) => setError(`Unable to load community rankings: ${getAuthErrorMessage(snapshotError)}`),
  ), []);

  return <section className="dashboard-card community-rankings" aria-labelledby="community-rankings-title">
    <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">COMMUNITY</p><h2 id="community-rankings-title">Top exchange partners</h2></div></div>
    {error ? <p className="dashboard-message dashboard-error" role="alert">{error}</p> : members.length
      ? <ol>{members.map((member, index) => <li key={member.id}>
        <span className="ranking-place">{index + 1}</span>
        <Link href={`/profile/${member.id}`}>{member.displayName || "Skill Swap member"}</Link>
        <span>{member.completedExchangeCount ?? 0} exchanges · {(member.rating ?? 0).toFixed(1)} ★</span>
      </li>)}</ol>
      : <p className="exchange-chat-empty">Rankings appear as members complete exchanges.</p>}
  </section>;
}

export function IdVerificationForm() {
  const { user } = useAuth();
  const [verification, setVerification] = useState<VerificationRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, "idVerifications", user.uid),
      (snapshot) => setVerification(snapshot.exists() ? snapshot.data() as VerificationRecord : null),
      (snapshotError) => setError(`Unable to load verification status: ${getAuthErrorMessage(snapshotError)}`),
    );
  }, [user]);

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || busy) return;
    const form = event.currentTarget;
    const documentInput = form.elements.namedItem("identity-document");
    const file = documentInput instanceof HTMLInputElement ? documentInput.files?.[0] : undefined;
    if (!file) return;
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or PDF identity document.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Identity documents must be 10 MB or smaller.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const path = `identityDocuments/${user.uid}/${crypto.randomUUID()}`;
    const storageRef = ref(storage, path);
    const documentName = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120);
    try {
      await uploadBytes(storageRef, file, {
        contentType: file.type,
        customMetadata: { ownerUid: user.uid },
      });
      const payload = {
        userId: user.uid,
        storagePath: path,
        documentName,
        contentType: file.type,
        sizeBytes: file.size,
        status: "pending",
        storageDeleted: false,
        reviewNote: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (verification?.status === "rejected") {
        await updateDoc(doc(db, "idVerifications", user.uid), {
          storagePath: payload.storagePath,
          documentName: payload.documentName,
          contentType: payload.contentType,
          sizeBytes: payload.sizeBytes,
          status: payload.status,
          storageDeleted: false,
          reviewNote: payload.reviewNote,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, "idVerifications", user.uid), payload);
      }
      setNotice("Your identity document was submitted privately for admin review.");
      form.reset();
      if (verification?.storagePath && verification.storagePath !== path) {
        try {
          await deleteObject(ref(storage, verification.storagePath));
        } catch (cleanupError) {
          console.error("Unable to remove the previous identity-document upload.", cleanupError);
          setNotice("Your new document is pending review. The previous upload could not be removed automatically; contact an administrator.");
        }
      }
    } catch (uploadError) {
      try {
        await deleteObject(storageRef);
      } catch (cleanupError) {
        console.error("Unable to clean up an incomplete identity-document upload.", cleanupError);
      }
      setError(getAuthErrorMessage(uploadError));
    } finally {
      setBusy(false);
    }
  }

  return <section className="dashboard-card id-verification-panel" aria-labelledby="id-verification-title">
    <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">ACCOUNT TRUST</p><h2 id="id-verification-title">Identity verification</h2></div>
      {verification && <span className={`request-status ${verification.status}`}>{verification.status}</span>}
    </div>
    <p className="exchange-chat-empty">Documents are private to you and authorized administrators. Upload a JPEG, PNG, or PDF (10 MB max); do not upload financial or unrelated records.</p>
    {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
    {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}
    {verification?.status === "approved" ? <p className="verification-approved">Your identity has been verified.</p> : <>
      {verification?.documentName && <p className="verification-file">Submitted document: {verification.documentName}</p>}
      {verification?.reviewNote && <p className="verification-note">Admin note: {verification.reviewNote}</p>}
      {verification?.status !== "pending" && <form className="verification-upload-form" onSubmit={(event) => void submitEvidence(event)}>
        <label className="dashboard-field"><span>Identity document</span><input type="file" name="identity-document" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" required /></label>
        <button className="primary-action" type="submit" disabled={busy}>{busy ? "Uploading securely..." : verification?.status === "rejected" ? "Resubmit document" : "Submit for verification"}</button>
      </form>}
      {verification?.status === "pending" && <p className="verification-pending">Your document is in the private review queue.</p>}
    </>}
  </section>;
}
