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
  scheduleStatus?: "proposed" | "selected" | "confirmed";
  scheduleProposerId?: string | null;
  scheduleOptions?: Timestamp[];
  scheduleSelectedIndex?: number | null;
  scheduleMode?: "online" | "onsite";
  schedulePlatform?: string;
  scheduleVenue?: string;
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

function displayDate(value?: Timestamp) {
  return value?.toDate().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }) ?? "Sending…";
}

function scheduleOptionLabel(value: Timestamp, timeZone?: string) {
  const localTime = value.toDate().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return timeZone ? `${localTime} (your local time; proposed in ${timeZone})` : localTime;
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
  const [scheduleOptionsInput, setScheduleOptionsInput] = useState([""]);
  const [scheduleMode, setScheduleMode] = useState<"online" | "onsite">("online");
  const [schedulePlatform, setSchedulePlatform] = useState("");
  const [scheduleVenue, setScheduleVenue] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const [showProposalForm, setShowProposalForm] = useState(false);
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

  async function submitScheduleProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const dates = scheduleOptionsInput
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));
    if (!dates.length || scheduleOptionsInput.some((value) => value && Number.isNaN(new Date(value).getTime()))) {
      setError("Enter at least one valid available date and time.");
      return;
    }
    if (dates.some((date) => date.getTime() <= Date.now())) {
      setError("All proposed times must be in the future.");
      return;
    }
    if (new Set(dates.map((date) => date.getTime())).size !== dates.length) {
      setError("Choose a different date and time for each availability option.");
      return;
    }
    if (scheduleMode === "onsite" && !scheduleVenue.trim()) {
      setError("Enter a venue or meeting place for an onsite exchange.");
      return;
    }
    if (scheduleMode === "online" && !schedulePlatform.trim()) {
      setError("Enter the online platform you want to use.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateDoc(doc(db, "swapRequests", requestId), {
        scheduleStatus: "proposed",
        scheduleProposerId: currentUserId,
        scheduleOptions: dates
          .sort((first, second) => first.getTime() - second.getTime())
          .map((date) => Timestamp.fromDate(date)),
        scheduleSelectedIndex: null,
        scheduleMode,
        scheduleTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        schedulePlatform: scheduleMode === "online" ? schedulePlatform.trim() : "",
        scheduleVenue: scheduleMode === "onsite" ? scheduleVenue.trim() : "",
        scheduleNote: scheduleMode === "online" ? scheduleNote.trim() : "",
        scheduledAt: null,
        updatedAt: serverTimestamp(),
      });
      setScheduleOptionsInput([""]);
      setSchedulePlatform("");
      setScheduleVenue("");
      setScheduleNote("");
      setShowProposalForm(false);
      setNotice("Your available times were sent to your swap partner.");
    } catch (proposalError) {
      setError(getAuthErrorMessage(proposalError));
    } finally {
      setBusy(false);
    }
  }

  async function selectScheduleOption(index: number) {
    if (requestStatus !== "accepted" || !record || busy || record.scheduleStatus !== "proposed"
      || record.scheduleProposerId === currentUserId || index < 0
      || index >= (record.scheduleOptions?.length ?? 0)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateDoc(doc(db, "swapRequests", requestId), {
        scheduleStatus: "selected",
        scheduleSelectedIndex: index,
        updatedAt: serverTimestamp(),
      });
      setNotice("You selected a time. Your partner needs to confirm it.");
    } catch (selectionError) {
      setError(getAuthErrorMessage(selectionError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSchedule() {
    if (requestStatus !== "accepted" || !record || busy || record.scheduleStatus !== "selected"
      || record.scheduleProposerId !== currentUserId) return;
    const selectedIndex = record.scheduleSelectedIndex;
    const selectedTime = selectedIndex === null || selectedIndex === undefined
      ? undefined
      : record.scheduleOptions?.[selectedIndex];
    if (!selectedTime || selectedTime.toMillis() <= Date.now()) {
      setError("That proposed time has passed. Send new available times instead.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateDoc(doc(db, "swapRequests", requestId), {
        scheduleStatus: "confirmed",
        scheduledAt: selectedTime,
        updatedAt: serverTimestamp(),
      });
      setNotice("The exchange time is confirmed.");
    } catch (confirmationError) {
      setError(getAuthErrorMessage(confirmationError));
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

  const selectedScheduleOption = record?.scheduleSelectedIndex === null
    || record?.scheduleSelectedIndex === undefined
    ? undefined
    : record.scheduleOptions?.[record.scheduleSelectedIndex];
  const hasConfirmedSchedule = Boolean(record?.scheduledAt)
    && (record?.scheduleStatus === "confirmed" || !record?.scheduleStatus);

  return <section className="exchange-workspace" aria-label="Exchange schedule and chat">
    {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
    {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}
    <div className="exchange-tools-grid">
      <section className="exchange-tool-card" aria-label="Schedule this exchange">
        <h4>Schedule this exchange</h4>
        {hasConfirmedSchedule && record?.scheduledAt && <div className="exchange-schedule-current">
          <strong>Confirmed:</strong> {record.scheduledAt.toDate().toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })} (your local time)
          {record.scheduleTimeZone && <span> · Proposed in {record.scheduleTimeZone}</span>}
          {record.scheduleMode === "online" && <p>Online · {record.schedulePlatform || "platform to be confirmed"}{record.scheduleNote ? ` · ${record.scheduleNote}` : ""}</p>}
          {record.scheduleMode === "onsite" && <p>Onsite · {record.scheduleVenue || record.scheduleNote}</p>}
          {!record.scheduleMode && record.scheduleNote && <p>{record.scheduleNote}</p>}
        </div>}
        {record?.scheduleStatus === "proposed" && <>
          <p className="exchange-chat-empty">{record.scheduleProposerId === currentUserId
            ? "Your available times are waiting for your partner to choose."
            : "Your partner shared these available times. Choose one or suggest another set."}</p>
          <ul className="exchange-schedule-options">
            {(record.scheduleOptions ?? []).map((option, index) => <li key={`${option.toMillis()}-${index}`}>
              <span>{scheduleOptionLabel(option, record.scheduleTimeZone)}</span>
              {requestStatus === "accepted" && record.scheduleProposerId !== currentUserId && <button className="secondary-action" type="button" disabled={busy} onClick={() => void selectScheduleOption(index)}>Choose this time</button>}
            </li>)}
          </ul>
        </>}
        {record?.scheduleStatus && record.scheduleStatus !== "confirmed" && <p className="exchange-chat-empty">{record.scheduleMode === "online"
          ? `Online · ${record.schedulePlatform || "Platform not specified"}${record.scheduleNote ? ` · ${record.scheduleNote}` : ""}`
          : `Onsite · ${record.scheduleVenue || "Venue not specified"}`}</p>}
        {record?.scheduleStatus === "selected" && selectedScheduleOption && <>
          <p className="exchange-schedule-current">Selected time: {scheduleOptionLabel(selectedScheduleOption, record.scheduleTimeZone)}</p>
          {record.scheduleProposerId === currentUserId
            ? <button className="primary-action" type="button" disabled={busy} onClick={() => void confirmSchedule()}>Confirm this time</button>
            : <p className="exchange-chat-empty">Waiting for your partner to confirm this time.</p>}
        </>}
        {requestStatus === "accepted" && (showProposalForm
          ? <form className="exchange-schedule-form" onSubmit={(event) => void submitScheduleProposal(event)}>
            <h4>Share your availability</h4>
            <p className="exchange-chat-empty">Offer up to five times that work for you. Your partner can choose one.</p>
            {scheduleOptionsInput.map((value, index) => <label className="dashboard-field" key={index}>
              <span>Available time {index + 1}</span>
              <div className="exchange-availability-row">
                <input type="datetime-local" value={value} onChange={(event) => setScheduleOptionsInput((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
                {scheduleOptionsInput.length > 1 && <button className="text-action destructive-action" type="button" onClick={() => setScheduleOptionsInput((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
              </div>
            </label>)}
            {scheduleOptionsInput.length < 5 && <button className="text-action" type="button" onClick={() => setScheduleOptionsInput((current) => [...current, ""])}>＋ Add another time</button>}
            <label className="dashboard-field"><span>Meeting format</span><select value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as typeof scheduleMode)}><option value="online">Online</option><option value="onsite">Onsite</option></select></label>
            {scheduleMode === "online"
              ? <><label className="dashboard-field"><span>Online platform</span><input value={schedulePlatform} onChange={(event) => setSchedulePlatform(event.target.value)} maxLength={80} placeholder="e.g. Google Meet, Zoom, Discord" required /></label><label className="dashboard-field"><span>Meeting link or instructions <small>Optional</small></span><input value={scheduleNote} onChange={(event) => setScheduleNote(event.target.value)} maxLength={240} placeholder="Add a link or joining details" /></label></>
              : <label className="dashboard-field"><span>Venue or meeting place <small>Choose a public place</small></span><input value={scheduleVenue} onChange={(event) => setScheduleVenue(event.target.value)} maxLength={240} placeholder="e.g. library, campus, or public cafe" required /></label>}
            <div className="exchange-schedule-actions"><button className="secondary-action" type="button" onClick={() => setShowProposalForm(false)}>Cancel</button><button className="primary-action" type="submit" disabled={busy}>{busy ? "Sending..." : "Send available times"}</button></div>
          </form>
          : <button className="secondary-action" type="button" onClick={() => setShowProposalForm(true)}>{record?.scheduleStatus ? "Suggest new times" : "Share your available times"}</button>)}
      </section>
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
