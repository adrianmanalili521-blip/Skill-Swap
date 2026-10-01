"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";

interface UserProfile {
  displayName?: string;
  email?: string;
  bio?: string;
  skillsOffered?: string[];
  learningGoals?: string[];
  rating?: number;
  ratingCount?: number;
}

function parseList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export default function DashboardPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bio, setBio] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    const authenticatedUser = user;
    let active = true;

    async function loadProfile() {
      setLoadingProfile(true);
      setError(null);
      try {
        const snapshot = await getDoc(doc(db, "users", authenticatedUser.uid));
        if (!snapshot.exists()) {
          throw new Error("Your profile is missing. Sign out and sign in again to create it.");
        }

        const data = snapshot.data() as UserProfile;
        if (!active) return;
        setProfile(data);
        setBio(data.bio ?? "");
        setSkillsText((data.skillsOffered ?? []).join(", "));
        setGoalsText((data.learningGoals ?? []).join(", "));
      } catch (profileError) {
        if (active) setError(getAuthErrorMessage(profileError));
      } finally {
        if (active) setLoadingProfile(false);
      }
    }

    void loadProfile();
    return () => { active = false; };
  }, [user]);

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    const nextProfile = {
      bio: bio.trim(),
      skillsOffered: parseList(skillsText),
      learningGoals: parseList(goalsText),
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, "users", user.uid), nextProfile);
      setProfile((current) => current ? { ...current, ...nextProfile, updatedAt: undefined } : current);
      setNotice("Profile saved.");
    } catch (profileError) {
      setError(getAuthErrorMessage(profileError));
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      router.replace("/");
    } catch (signOutError) {
      setError(getAuthErrorMessage(signOutError));
      setSigningOut(false);
    }
  }

  if (loading) {
    return (
      <main className="dashboard-loading" role="status">
        <span className="loading-indicator" />
        <span>Checking your session</span>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="dashboard-loading" role="status">
        <span className="loading-indicator" />
        <span>Returning to sign in</span>
      </main>
    );
  }

  const displayName = profile?.displayName || user.displayName || "there";
  const skillsOffered = profile?.skillsOffered ?? [];
  const learningGoals = profile?.learningGoals ?? [];

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <a className="dashboard-brand" href="/dashboard">
          <span className="dashboard-brand-mark" aria-hidden="true">s</span>
          <span>skill swap</span>
        </a>
        <div className="dashboard-header-actions">
          <span className="dashboard-user-email">{user.email}</span>
          <button className="dashboard-signout" type="button" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </header>

      <div className="dashboard-main">
        <section className="dashboard-welcome">
          <p className="dashboard-eyebrow">YOUR SKILL SWAP</p>
          <h1>Welcome, {displayName}.</h1>
          <p>Make room for something new by sharing what you know.</p>
        </section>

        {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
        {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}

        <section className="dashboard-stats" aria-label="Your profile summary">
          <article className="dashboard-stat">
            <span className="dashboard-stat-number">{loadingProfile ? "..." : skillsOffered.length}</span>
            <span className="dashboard-stat-label">Skills you can teach</span>
          </article>
          <article className="dashboard-stat">
            <span className="dashboard-stat-number">{loadingProfile ? "..." : learningGoals.length}</span>
            <span className="dashboard-stat-label">Things you want to learn</span>
          </article>
          <article className="dashboard-stat">
            <span className="dashboard-stat-number">
              {profile?.ratingCount ? profile.rating?.toFixed(1) ?? "0.0" : "New"}
            </span>
            <span className="dashboard-stat-label">Community rating</span>
          </article>
        </section>

        <div className="dashboard-content-grid">
          <section className="dashboard-card profile-card">
            <div className="dashboard-card-heading">
              <div>
                <p className="dashboard-eyebrow">YOUR PROFILE</p>
                <h2>A little about you</h2>
              </div>
              <span className="profile-avatar" aria-hidden="true">
                {displayName.slice(0, 1).toUpperCase()}
              </span>
            </div>

            {loadingProfile ? (
              <div className="profile-loading" role="status">Loading your profile...</div>
            ) : (
              <form className="profile-form" onSubmit={handleSaveProfile}>
                <label className="dashboard-field">
                  <span>Display name</span>
                  <input value={profile?.displayName ?? user.displayName ?? ""} readOnly />
                </label>
                <label className="dashboard-field">
                  <span>Bio</span>
                  <textarea
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    maxLength={280}
                    placeholder="What do you enjoy teaching or learning?"
                    rows={3}
                  />
                </label>
                <label className="dashboard-field">
                  <span>Skills you can teach</span>
                  <input
                    value={skillsText}
                    onChange={(event) => setSkillsText(event.target.value)}
                    placeholder="e.g. Guitar, Excel, Spanish"
                  />
                </label>
                <label className="dashboard-field">
                  <span>Skills you want to learn</span>
                  <input
                    value={goalsText}
                    onChange={(event) => setGoalsText(event.target.value)}
                    placeholder="e.g. Pottery, Public speaking"
                  />
                </label>
                <button className="dashboard-save" type="submit" disabled={saving || loadingProfile}>
                  {saving ? "Saving..." : "Save profile"}
                  {!saving && <span aria-hidden="true">→</span>}
                </button>
              </form>
            )}
          </section>

          <aside className="dashboard-side-column">
            <section className="dashboard-card exchange-card">
              <p className="dashboard-eyebrow">YOUR EXCHANGE</p>
              <h2>Start with what you know.</h2>
              <p>
                {skillsOffered.length
                  ? `${skillsOffered[0]}${skillsOffered.length > 1 ? ` and ${skillsOffered.length - 1} more` : ""} is on your profile.`
                  : "Add a skill you enjoy sharing to get your profile started."}
              </p>
              <div className="exchange-card-rule" />
              <span className="exchange-card-mark" aria-hidden="true">S / S</span>
            </section>

            <section className="dashboard-card goals-card">
              <p className="dashboard-eyebrow">ON YOUR LEARNING LIST</p>
              {learningGoals.length ? (
                <ul className="dashboard-goal-list">
                  {learningGoals.slice(0, 3).map((goal) => <li key={goal}>{goal}</li>)}
                </ul>
              ) : (
                <p className="dashboard-empty">Your next skill could be anything.</p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}