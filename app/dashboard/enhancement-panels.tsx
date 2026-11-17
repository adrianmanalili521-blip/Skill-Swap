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
import { DEFAULT_SKILL_DURATION_MINUTES } from "@/lib/skill-listing-format";
import {
  AVAILABILITY_DAYS,
  isValidTimeZone,
  minuteToTime,
  parseWeeklyAvailability,
  getAvailableTimesForDate,
  localDateInput,
  timeToMinute,
  type AvailabilityDay,
  type WeeklyAvailability,
} from "@/lib/weekly-availability";

type AvailabilityDraft = Record<AvailabilityDay, {
  enabled: boolean;
  start: string;
  end: string;
}>;

function availabilityDraftFrom(value: WeeklyAvailability = {}): AvailabilityDraft {
  return Object.fromEntries(AVAILABILITY_DAYS.map(({ key }) => {
    const window = value[key];
    return [key, {
      enabled: Boolean(window),
      start: minuteToTime(window?.startMinute ?? 9 * 60),
      end: minuteToTime(window?.endMinute ?? 17 * 60),
    }];
  })) as AvailabilityDraft;
}

interface PrivateAvailabilityRecord {
  weeklyAvailability: WeeklyAvailability;
  timeZone: string;
  updatedAt?: Timestamp;
}

export function WeeklyAvailabilitySettings() {
  const { user } = useAuth();
  const [draft, setDraft] = useState<AvailabilityDraft>(() => availabilityDraftFrom());
  const [timeZone, setTimeZone] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getDoc(doc(db, "users", user.uid, "privateAvailability", "weekly"))
      .then((snapshot) => {
        if (!active) return;
        const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        if (!snapshot.exists()) {
          setTimeZone(browserTimeZone);
          return;
        }
        const data = snapshot.data();
        const availability = parseWeeklyAvailability(data.weeklyAvailability);
        const savedTimeZone = typeof data.timeZone === "string" ? data.timeZone : "";
        if (!availability || !isValidTimeZone(savedTimeZone)) {
          setError("Your saved weekly availability is invalid. Update it and save again.");
          return;
        }
        setDraft(availabilityDraftFrom(availability));
        setTimeZone(savedTimeZone);
      })
      .catch((loadError: unknown) => {
        if (active) setError(`Unable to load weekly availability: ${getAuthErrorMessage(loadError)}`);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  async function saveAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || busy) return;
    const weeklyAvailability: WeeklyAvailability = {};
    for (const { key, label } of AVAILABILITY_DAYS) {
      const entry = draft[key];
      if (!entry.enabled) continue;
      const startMinute = timeToMinute(entry.start);
      const endMinute = timeToMinute(entry.end);
      if (startMinute === null || endMinute === null || endMinute >= 1440 || endMinute <= startMinute
        || startMinute % 15 !== 0 || endMinute % 15 !== 0) {
        setError(`${label}: choose a valid 15-minute time range where the end is after the start.`);
        return;
      }
      weeklyAvailability[key] = { startMinute, endMinute };
    }
    const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setDoc(doc(db, "users", user.uid, "privateAvailability", "weekly"), {
        weeklyAvailability,
        timeZone: currentTimeZone,
        updatedAt: serverTimestamp(),
      });
      setTimeZone(currentTimeZone);
      setNotice("Weekly availability saved. Share it from an accepted swap to use it for booking.");
    } catch (saveError) {
      setError(`Unable to save weekly availability: ${getAuthErrorMessage(saveError)}`);
    } finally {
      setBusy(false);
    }
  }

  return <section className="dashboard-card availability-settings" aria-labelledby="weekly-availability-heading">
    <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">SCHEDULING</p><h2 id="weekly-availability-heading">Weekly availability</h2></div></div>
    <p className="availability-description">Set one recurring time window per day. Only you can see this profile setting; it is shared with a partner only after a swap is accepted.</p>
    {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
    {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}
    <form className="availability-form" onSubmit={(event) => void saveAvailability(event)}>
      <p className="availability-time-zone">Times use {timeZone || "your local time zone"}.</p>
      {AVAILABILITY_DAYS.map(({ key, label }) => <div className="availability-day" key={key}>
        <label><input type="checkbox" checked={draft[key].enabled} onChange={(event) => setDraft((current) => ({ ...current, [key]: { ...current[key], enabled: event.target.checked } }))} /><span>{label}</span></label>
        {draft[key].enabled && <div className="availability-time-range">
          <input type="time" step={900} aria-label={`${label} available from`} value={draft[key].start} onChange={(event) => setDraft((current) => ({ ...current, [key]: { ...current[key], start: event.target.value } }))} />
          <span>to</span>
          <input type="time" step={900} aria-label={`${label} available until`} value={draft[key].end} onChange={(event) => setDraft((current) => ({ ...current, [key]: { ...current[key], end: event.target.value } }))} />
        </div>}
      </div>)}
      <button className="primary-action" type="submit" disabled={busy || loading}>{busy ? "Saving..." : "Save weekly availability"}</button>
    </form>
  </section>;
}

interface ExchangeRecord {
  id: string;
  status: "accepted" | "completed";
  fromUserId: string;
  toUserId: string;
  durationMinutes?: number;
  scheduledAt?: Timestamp | null;
  scheduleDurationMinutes?: number;
  scheduleTimeZone?: string;
  scheduleNote?: string;
  scheduleStatus?: "proposed" | "selected" | "confirmed";
  scheduleProposerId?: string | null;
  scheduleOptions?: Timestamp[];
  scheduleSelectedIndex?: number | null;
  scheduleMode?: "online" | "onsite";
  schedulePlatform?: string;
  scheduleVenue?: string;
  fromWeeklyAvailability?: unknown;
  fromAvailabilityTimeZone?: string;
  fromAvailabilityUpdatedAt?: Timestamp | null;
  toWeeklyAvailability?: unknown;
  toAvailabilityTimeZone?: string;
  toAvailabilityUpdatedAt?: Timestamp | null;
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

function isFutureDate(value: Date) {
  return value.getTime() > Date.now();
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
  const [myAvailability, setMyAvailability] = useState<PrivateAvailabilityRecord | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");
  const [selectedScheduleTime, setSelectedScheduleTime] = useState("");
  const [calendarNow, setCalendarNow] = useState(0);
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

  useEffect(() => {
    let active = true;
    void getDoc(doc(db, "users", currentUserId, "privateAvailability", "weekly"))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) {
          setMyAvailability(null);
          return;
        }
        const data = snapshot.data();
        const weeklyAvailability = parseWeeklyAvailability(data.weeklyAvailability);
        const timeZone = typeof data.timeZone === "string" ? data.timeZone : "";
        if (!weeklyAvailability || !isValidTimeZone(timeZone)) {
          setError("Your saved weekly availability is invalid. Update it in your profile before scheduling.");
          setMyAvailability(null);
          return;
        }
        setMyAvailability({
          weeklyAvailability,
          timeZone,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : undefined,
        });
      })
      .catch((availabilityError: unknown) => {
        if (active) setError(`Unable to load your weekly availability: ${getAuthErrorMessage(availabilityError)}`);
      })
      .finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [currentUserId]);

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
    const date = availableTimes.find((candidate) => candidate.toISOString() === selectedScheduleTime);
    if (!date) {
      setError("Choose a calendar time that fits both participants' shared availability.");
      return;
    }
    if (!isFutureDate(date)) {
      setError("That time has passed. Choose a future calendar time.");
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
        scheduleOptions: [Timestamp.fromDate(date)],
        scheduleSelectedIndex: null,
        scheduleDurationMinutes: record?.durationMinutes ?? DEFAULT_SKILL_DURATION_MINUTES * 2,
        scheduleMode,
        scheduleTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        schedulePlatform: scheduleMode === "online" ? schedulePlatform.trim() : "",
        scheduleVenue: scheduleMode === "onsite" ? scheduleVenue.trim() : "",
        scheduleNote: scheduleMode === "online" ? scheduleNote.trim() : "",
        scheduledAt: null,
        updatedAt: serverTimestamp(),
      });
      setSelectedScheduleTime("");
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

  async function shareAvailability() {
    if (!record || !myAvailability || busy || requestStatus !== "accepted") return;
    const prefix = record.fromUserId === currentUserId ? "from" : "to";
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateDoc(doc(db, "swapRequests", requestId), {
        [`${prefix}WeeklyAvailability`]: myAvailability.weeklyAvailability,
        [`${prefix}AvailabilityTimeZone`]: myAvailability.timeZone,
        [`${prefix}AvailabilityUpdatedAt`]: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNotice("Your weekly availability is now shared with your swap partner.");
    } catch (shareError) {
      setError(getAuthErrorMessage(shareError));
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

  const sessionDuration = record?.durationMinutes ?? DEFAULT_SKILL_DURATION_MINUTES * 2;
  const selectedScheduleOption = record?.scheduleSelectedIndex === null
    || record?.scheduleSelectedIndex === undefined
    ? undefined
    : record.scheduleOptions?.[record.scheduleSelectedIndex];
  const hasConfirmedSchedule = Boolean(record?.scheduledAt)
    && (record?.scheduleStatus === "confirmed" || !record?.scheduleStatus);
  const fromAvailability = parseWeeklyAvailability(record?.fromWeeklyAvailability);
  const toAvailability = parseWeeklyAvailability(record?.toWeeklyAvailability);
  const fromTimeZone = record?.fromAvailabilityTimeZone;
  const toTimeZone = record?.toAvailabilityTimeZone;
  const schedulingReady = Boolean(fromAvailability && toAvailability
    && fromTimeZone && toTimeZone
    && isValidTimeZone(fromTimeZone) && isValidTimeZone(toTimeZone));
  const ownAvailabilityShared = record?.fromUserId === currentUserId
    ? Boolean(record?.fromWeeklyAvailability && record.fromAvailabilityTimeZone)
    : Boolean(record?.toWeeklyAvailability && record.toAvailabilityTimeZone);
  const ownSharedAt = record?.fromUserId === currentUserId
    ? record?.fromAvailabilityUpdatedAt
    : record?.toAvailabilityUpdatedAt;
  const ownAvailabilityIsCurrent = Boolean(myAvailability?.updatedAt && ownSharedAt
    && ownSharedAt.toMillis() >= myAvailability.updatedAt.toMillis());
  const availableTimes = !selectedCalendarDate || !fromAvailability || !toAvailability || !fromTimeZone || !toTimeZone
    ? []
    : getAvailableTimesForDate(
      selectedCalendarDate,
      sessionDuration,
      fromAvailability,
      fromTimeZone,
      toAvailability,
      toTimeZone,
    ).filter((time) => time.getTime() > calendarNow);

  if (requestStatus !== "accepted" && requestStatus !== "completed") return null;

  return <section className="exchange-workspace" aria-label="Exchange schedule and chat">
    {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
    {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}
    <div className="exchange-tools-grid">
      <section className="exchange-tool-card" aria-label="Schedule this exchange">
        <h4>Schedule this exchange</h4>
        <p className="exchange-chat-empty">Combined session duration: {record?.scheduleDurationMinutes ?? sessionDuration} minutes, based on both skill listings.</p>
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
        {requestStatus === "accepted" && <div className="exchange-availability-sharing">
          <p className="exchange-chat-empty">Your private weekly schedule is visible only to you until you share it here. Your partner must also share theirs before calendar times can be offered.</p>
          {availabilityLoading
            ? <p className="exchange-chat-empty">Loading your weekly availability...</p>
            : myAvailability
              ? <div className="exchange-availability-row"><span className="exchange-chat-empty">{!ownAvailabilityShared ? "Your schedule has not been shared with this partner yet." : ownAvailabilityIsCurrent ? "Your current schedule is shared with this partner." : "Your private schedule changed after it was shared; refresh it before proposing a time."}</span><button className="text-action" type="button" disabled={busy} onClick={() => void shareAvailability()}>{ownAvailabilityShared && ownAvailabilityIsCurrent ? "Refresh shared schedule" : "Share updated schedule"}</button></div>
              : <p className="exchange-chat-empty">Add weekly availability in your <Link href="/dashboard">profile settings</Link> before scheduling.</p>}
        </div>}
        {requestStatus === "accepted" && !schedulingReady && <p className="exchange-chat-empty">Calendar booking will be available once both participants share a valid weekly schedule.</p>}
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
            <h4>Choose a time from the shared calendar</h4>
            <p className="exchange-chat-empty">Only times that fit both participants&apos; weekly availability for {sessionDuration} minutes are shown.</p>
            <label className="dashboard-field"><span>Calendar date</span><input type="date" value={selectedCalendarDate} onChange={(event) => { setSelectedCalendarDate(event.target.value); setSelectedScheduleTime(""); }} required /></label>
            <label className="dashboard-field"><span>Available start time</span><select value={selectedScheduleTime} onChange={(event) => setSelectedScheduleTime(event.target.value)} required disabled={!schedulingReady || availableTimes.length === 0}><option value="">{availableTimes.length ? "Choose a time" : "No matching times for this date"}</option>{availableTimes.map((time) => <option key={time.toISOString()} value={time.toISOString()}>{time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</option>)}</select></label>
            <label className="dashboard-field"><span>Meeting format</span><select value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as typeof scheduleMode)}><option value="online">Online</option><option value="onsite">Onsite</option></select></label>
            {scheduleMode === "online"
              ? <><label className="dashboard-field"><span>Online platform</span><input value={schedulePlatform} onChange={(event) => setSchedulePlatform(event.target.value)} maxLength={80} placeholder="e.g. Google Meet, Zoom, Discord" required /></label><label className="dashboard-field"><span>Meeting link or instructions <small>Optional</small></span><input value={scheduleNote} onChange={(event) => setScheduleNote(event.target.value)} maxLength={240} placeholder="Add a link or joining details" /></label></>
              : <label className="dashboard-field"><span>Venue or meeting place <small>Choose a public place</small></span><input value={scheduleVenue} onChange={(event) => setScheduleVenue(event.target.value)} maxLength={240} placeholder="e.g. library, campus, or public cafe" required /></label>}
            <div className="exchange-schedule-actions"><button className="secondary-action" type="button" onClick={() => setShowProposalForm(false)}>Cancel</button><button className="primary-action" type="submit" disabled={busy || !schedulingReady || !selectedScheduleTime}>{busy ? "Sending..." : "Propose this time"}</button></div>
          </form>
          : <button className="secondary-action" type="button" disabled={!schedulingReady} onClick={() => { const now = new Date(); setCalendarNow(now.getTime()); setSelectedCalendarDate(localDateInput(now)); setSelectedScheduleTime(""); setShowProposalForm(true); }}>{record?.scheduleStatus ? "Suggest a new calendar time" : "Choose a calendar time"}</button>)}
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
