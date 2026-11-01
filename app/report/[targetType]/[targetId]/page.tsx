"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { useTheme } from "@/lib/theme-context";

export default function ReportPage() {
  const params = useParams<{ targetType: string; targetId: string }>();
  const targetType = params.targetType === "user" || params.targetType === "listing" ? params.targetType : null;
  const targetId = params.targetId;
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, router, user]);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!user || !targetType || !targetId || trimmedReason.length < 10 || trimmedReason.length > 1000) {
      setError("Describe the concern in 10–1,000 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await addDoc(collection(db, "reports"), {
        reporterId: user.uid,
        reporterName: (user.displayName || user.email || "Skill Swap member").slice(0, 100),
        targetType,
        targetId,
        reason: trimmedReason,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubmitted(true);
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError));
      setSubmitting(false);
    }
  }

  if (loading || !user) return <main className="dashboard-loading" role="status">Checking your account…</main>;
  if (!targetType || !targetId) return <main className="dashboard-loading" role="alert">This report link is invalid.</main>;

  if (submitted) return <main className="dashboard-shell public-profile-shell" data-theme={theme}>
    <header className="dashboard-header"><Link className="dashboard-brand" href="/dashboard"><span className="dashboard-brand-mark" aria-hidden="true">s</span><span>skill swap</span></Link><Link className="back-link" href="/dashboard">← Back to dashboard</Link></header>
    <section className="report-form-page"><p className="dashboard-eyebrow">COMMUNITY SAFETY</p><h1>Report received</h1><p>Your report has been sent to the moderation team. Thank you for helping keep Skill Swap welcoming.</p><Link className="admin-button primary" href="/dashboard">Return to dashboard</Link></section>
  </main>;

  return <main className="dashboard-shell public-profile-shell" data-theme={theme}>
    <header className="dashboard-header"><Link className="dashboard-brand" href="/dashboard"><span className="dashboard-brand-mark" aria-hidden="true">s</span><span>skill swap</span></Link><Link className="back-link" href="/dashboard">← Back to dashboard</Link></header>
    <section className="report-form-page">
      <p className="dashboard-eyebrow">COMMUNITY SAFETY</p>
      <h1>Report {targetType === "user" ? "a member" : "a skill listing"}</h1>
      <p>Reports are reviewed by the Skill Swap moderation team. Include clear details so the team can investigate.</p>
      <form className="admin-form" onSubmit={(event) => void submitReport(event)}>
        <label>What happened?<textarea required minLength={10} maxLength={1000} rows={7} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe the issue and any relevant context." /></label>
        <small>{reason.trim().length}/1,000 characters</small>
        {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
        <button type="submit" className="admin-button primary" disabled={submitting}>{submitting ? "Submitting…" : "Submit report"}</button>
      </form>
    </section>
  </main>;
}
