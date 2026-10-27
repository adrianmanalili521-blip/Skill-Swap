"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { useTheme } from "@/lib/theme-context";

type View = "discover" | "listings" | "profile";
type SkillLevel = "beginner" | "intermediate" | "advanced";

interface UserProfile {
  displayName?: string;
  bio?: string;
  role?: string;
  skillsOffered?: string[];
  learningGoals?: string[];
  rating?: number;
  ratingCount?: number;
}

interface SkillListing {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description: string;
  category: string;
  level: SkillLevel;
  tags: string[];
  status: "active" | "paused" | "removed";
  createdAt?: { toMillis?: () => number };
}

const categories = ["Art & Design", "Business", "Cooking", "Crafts", "Language", "Music", "Technology", "Wellness", "Other"];

function parseList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function createdTime(listing: SkillListing) {
  return listing.createdAt?.toMillis?.() ?? 0;
}

export default function SprintTwoWorkspace() {
  const { user, loading, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [view, setView] = useState<View>("discover");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [listings, setListings] = useState<SkillListing[]>([]);
  const [bio, setBio] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [editing, setEditing] = useState<SkillListing | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    const currentUser = user;
    let active = true;
    async function loadDashboard() {
      setLoadingData(true);
      setError(null);
      try {
        const [profileSnapshot, activeSkillsSnapshot, ownSkillsSnapshot] = await Promise.all([
          getDoc(doc(db, "users", currentUser.uid)),
          getDocs(query(collection(db, "skills"), where("status", "==", "active"), orderBy("createdAt", "desc"))),
          getDocs(query(collection(db, "skills"), where("ownerId", "==", currentUser.uid))),
        ]);
        if (!profileSnapshot.exists()) throw new Error("Your profile is missing. Sign out and sign in again.");
        const nextProfile = profileSnapshot.data() as UserProfile;
        const skillDocs = new Map(activeSkillsSnapshot.docs.map((skillDoc) => [skillDoc.id, skillDoc]));
        ownSkillsSnapshot.docs.forEach((skillDoc) => skillDocs.set(skillDoc.id, skillDoc));
        const nextListings = [...skillDocs.values()].map((skillDoc) => ({ id: skillDoc.id, ...skillDoc.data() }) as SkillListing);
        if (!active) return;
        setProfile(nextProfile);
        setBio(nextProfile.bio ?? "");
        setSkillsText((nextProfile.skillsOffered ?? []).join(", "));
        setGoalsText((nextProfile.learningGoals ?? []).join(", "));
        setListings(nextListings.sort((first, second) => createdTime(second) - createdTime(first)));
      } catch (loadError) {
        if (active) setError(getAuthErrorMessage(loadError));
      } finally {
        if (active) setLoadingData(false);
      }
    }
    void loadDashboard();
    return () => { active = false; };
  }, [user]);

  const myListings = listings.filter((listing) => listing.ownerId === user?.uid && listing.status !== "removed");
  const discoveredListings = useMemo(() => {
    const term = search.trim().toLowerCase();
    return listings.filter((listing) => {
      if (listing.status !== "active" || listing.ownerId === user?.uid) return false;
      if (category !== "All categories" && listing.category !== category) return false;
      return !term || [listing.title, listing.description, listing.category, listing.ownerName, ...listing.tags]
        .some((text) => text?.toLowerCase().includes(term));
    });
  }, [category, listings, search, user?.uid]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setSaving(true); setError(null); setNotice(null);
    const update = { bio: bio.trim(), skillsOffered: parseList(skillsText), learningGoals: parseList(goalsText), updatedAt: serverTimestamp() };
    try {
      await updateDoc(doc(db, "users", user.uid), update);
      setProfile((current) => current ? { ...current, ...update } : current);
      setNotice("Profile saved.");
    } catch (saveError) { setError(getAuthErrorMessage(saveError)); }
    finally { setSaving(false); }
  }

  async function saveListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const form = new FormData(event.currentTarget);
    const data = {
      ownerId: user.uid,
      ownerName: profile?.displayName || user.displayName || "Skill Swap member",
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      category: String(form.get("category") ?? "Other"),
      level: String(form.get("level") ?? "beginner") as SkillLevel,
      tags: parseList(String(form.get("tags") ?? "")),
      status: editing?.status ?? "active",
      updatedAt: serverTimestamp(),
    };
    setSaving(true); setError(null);
    try {
      if (editing) {
        await updateDoc(doc(db, "skills", editing.id), data);
        setListings((current) => current.map((item) => item.id === editing.id ? { ...item, ...data } : item));
        setNotice("Listing updated.");
      } else {
        const created = await addDoc(collection(db, "skills"), { ...data, createdAt: serverTimestamp() });
        setListings((current) => [{ id: created.id, ...data }, ...current]);
        setNotice("Listing published.");
      }
      setShowEditor(false); setEditing(null);
    } catch (saveError) { setError(getAuthErrorMessage(saveError)); }
    finally { setSaving(false); }
  }

  async function setListingStatus(listing: SkillListing, status: "active" | "paused") {
    try {
      await updateDoc(doc(db, "skills", listing.id), { status, updatedAt: serverTimestamp() });
      setListings((current) => current.map((item) => item.id === listing.id ? { ...item, status } : item));
      setNotice(status === "paused" ? "Listing paused." : "Listing is active again.");
      setError(null);
    } catch (updateError) { setError(getAuthErrorMessage(updateError)); }
  }

  async function removeListing(listing: SkillListing) {
    if (!window.confirm(`Delete “${listing.title}”? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, "skills", listing.id));
      setListings((current) => current.filter((item) => item.id !== listing.id));
      setNotice("Listing deleted."); setError(null);
    } catch (deleteError) { setError(getAuthErrorMessage(deleteError)); }
  }

  async function onToggleTheme() {
    try { await toggleTheme(); setNotice("Theme preference saved."); }
    catch { setNotice("Theme changed on this device. Account sync was unavailable."); }
  }

  async function onSignOut() {
    setSigningOut(true); setError(null);
    try { await signOut(); router.replace("/"); }
    catch (signOutError) { setError(getAuthErrorMessage(signOutError)); setSigningOut(false); }
  }

  if (loading || !user) return <main className="dashboard-loading" role="status"><span className="loading-indicator" /><span>{loading ? "Checking your session" : "Returning to sign in"}</span></main>;
  const displayName = profile?.displayName || user.displayName || "there";

  return (
    <main className="dashboard-shell" data-theme={theme}>
      <header className="dashboard-header">
        <Link className="dashboard-brand" href="/dashboard"><span className="dashboard-brand-mark" aria-hidden="true">s</span><span>skill swap</span></Link>
        <nav className="dashboard-nav" aria-label="Main navigation">
          {(["discover", "listings", "profile"] as const).map((item) => <button key={item} className={view === item ? "dashboard-nav-item active" : "dashboard-nav-item"} type="button" onClick={() => { setView(item); setNotice(null); }}>{item === "listings" ? "My listings" : item === "discover" ? "Discover" : "Profile"}</button>)}
          {profile?.role === "admin" && <Link className="dashboard-nav-item admin-nav-link" href="/admin">Admin panel</Link>}
        </nav>
        <div className="dashboard-header-actions">
          <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}><span aria-hidden="true">{theme === "light" ? "◐" : "☀"}</span></button>
          <span className="dashboard-user-email">{user.email}</span>
          <button className="dashboard-signout" type="button" onClick={onSignOut} disabled={signingOut}>{signingOut ? "Signing out..." : "Sign out"}</button>
        </div>
      </header>
      <div className="dashboard-main">
        <section className="dashboard-welcome"><p className="dashboard-eyebrow">YOUR SKILL SWAP</p><h1>{view === "discover" ? "Find your next exchange." : view === "listings" ? "Share what you know." : `Welcome, ${displayName}.`}</h1><h2 className="dashboard-welcome-test">testing production!</h2><p>{view === "discover" ? "Explore practical skills shared by your community." : view === "listings" ? "Create clear offers and keep your listings up to date." : "A good exchange starts with a little context about you."}</p></section>
        {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}{notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}

        {view === "discover" && <section aria-label="Discover skills">
          <div className="discover-tools"><label className="search-field"><span className="search-icon" aria-hidden="true">⌕</span><span className="visually-hidden">Search skills, tags, or people</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search skills, tags, or people" /></label><label className="category-filter"><span className="visually-hidden">Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><button className="primary-action" type="button" onClick={() => { setEditing(null); setShowEditor(true); setView("listings"); }}><span aria-hidden="true">＋</span> Offer a skill</button></div>
          <div className="results-heading"><h2>Community skills</h2><span>{loadingData ? "Loading..." : `${discoveredListings.length} ${discoveredListings.length === 1 ? "listing" : "listings"}`}</span></div>
          {loadingData ? <div className="empty-state">Loading skills...</div> : discoveredListings.length ? <div className="skill-grid">{discoveredListings.map((listing, index) => <article className="skill-card" key={listing.id} style={{ animationDelay: `${Math.min(index * 45, 270)}ms` }}><div className="skill-card-topline"><span className="skill-category">{listing.category}</span><span className="skill-level">{listing.level}</span></div><h3>{listing.title}</h3><p className="skill-description">{listing.description || "This member is happy to share what they know."}</p>{listing.tags.length > 0 && <div className="skill-tags">{listing.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>}<div className="skill-card-footer"><Link href={`/profile/${listing.ownerId}`} className="listing-owner"><span className="mini-avatar">{listing.ownerName.slice(0, 1).toUpperCase()}</span><span>{listing.ownerName}</span></Link><span className="listing-status">Open to swap</span></div></article>)}</div> : <div className="empty-state"><strong>No matching skills yet.</strong><span>Try another search, or be the first to share a skill.</span></div>}
        </section>}

        {view === "listings" && <section aria-label="Manage your skill listings"><div className="section-toolbar"><div><h2>Your listings</h2><p>{myListings.length} total · {myListings.filter((item) => item.status === "active").length} active</p></div>{!showEditor && <button className="primary-action" type="button" onClick={() => { setEditing(null); setShowEditor(true); }}>＋ New listing</button>}</div>
          {showEditor && <form className="skill-editor" onSubmit={saveListing}><div className="editor-heading"><div><p className="dashboard-eyebrow">{editing ? "EDIT LISTING" : "NEW LISTING"}</p><h2>{editing ? "Refine your offer" : "What can you teach?"}</h2></div><button className="icon-button" type="button" onClick={() => { setShowEditor(false); setEditing(null); }} aria-label="Close listing form">×</button></div><div className="editor-grid"><label className="dashboard-field"><span>Skill title</span><input name="title" defaultValue={editing?.title ?? ""} maxLength={70} placeholder="e.g. Beginner watercolor techniques" required /></label><label className="dashboard-field"><span>Category</span><select name="category" defaultValue={editing?.category ?? categories[0]}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label className="dashboard-field"><span>Experience level</span><select name="level" defaultValue={editing?.level ?? "beginner"}><option value="beginner">Beginner friendly</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><label className="dashboard-field"><span>Tags <small>Separate with commas</small></span><input name="tags" defaultValue={editing?.tags.join(", ") ?? ""} placeholder="remote, materials included" /></label><label className="dashboard-field editor-description"><span>Description</span><textarea name="description" defaultValue={editing?.description ?? ""} maxLength={500} placeholder="What will someone learn? What should they bring?" rows={4} /></label></div><div className="editor-actions"><button className="secondary-action" type="button" onClick={() => { setShowEditor(false); setEditing(null); }}>Cancel</button><button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Publish listing"}</button></div></form>}
          {loadingData ? <div className="empty-state">Loading your listings...</div> : myListings.length ? <div className="managed-listings">{myListings.map((listing) => <article className="managed-listing" key={listing.id}><div className="managed-listing-copy"><span className={`status-dot ${listing.status}`} /> <span className="managed-category">{listing.category} · {listing.status}</span><h3>{listing.title}</h3><p>{listing.description || "No description added."}</p></div><div className="managed-listing-actions"><button className="text-action" type="button" onClick={() => { setEditing(listing); setShowEditor(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button><button className="text-action" type="button" onClick={() => setListingStatus(listing, listing.status === "paused" ? "active" : "paused")}>{listing.status === "paused" ? "Resume" : "Pause"}</button><button className="text-action destructive-action" type="button" onClick={() => removeListing(listing)}>Delete</button></div></article>)}</div> : !showEditor ? <div className="empty-state"><strong>Your first listing starts here.</strong><span>Share a skill you enjoy teaching and help someone take their next step.</span><button className="primary-action" type="button" onClick={() => setShowEditor(true)}>＋ Create a listing</button></div> : null}
        </section>}

        {view === "profile" && <div className="profile-view-grid"><section className="profile-editor dashboard-card"><div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">YOUR PROFILE</p><h2>A little about you</h2></div><span className="profile-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span></div>{loadingData ? <div className="profile-loading" role="status">Loading your profile...</div> : <form className="profile-form" onSubmit={saveProfile}><label className="dashboard-field"><span>Display name</span><input value={profile?.displayName ?? user.displayName ?? ""} readOnly /></label><label className="dashboard-field"><span>Bio</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={280} placeholder="What do you enjoy teaching or learning?" rows={4} /><small className="field-count">{bio.length}/280</small></label><label className="dashboard-field"><span>Skills you can teach <small>Separate with commas</small></span><input value={skillsText} onChange={(event) => setSkillsText(event.target.value)} placeholder="Guitar, Excel, Spanish" /></label><label className="dashboard-field"><span>Skills you want to learn <small>Separate with commas</small></span><input value={goalsText} onChange={(event) => setGoalsText(event.target.value)} placeholder="Pottery, public speaking" /></label><button className="primary-action profile-save" type="submit" disabled={saving || loadingData}>{saving ? "Saving..." : "Save profile"}</button></form>}</section><aside className="profile-summary"><div className="profile-summary-head"><span className="profile-avatar large" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span><h2>{displayName}</h2><p>{user.email}</p></div><div className="profile-summary-stats"><div><strong>{myListings.filter((item) => item.status === "active").length}</strong><span>Active listings</span></div><div><strong>{profile?.ratingCount ? profile.rating?.toFixed(1) ?? "0.0" : "New"}</strong><span>Community rating</span></div></div><div className="profile-summary-section"><p className="dashboard-eyebrow">SKILLS I OFFER</p><div className="profile-chips">{parseList(skillsText).length ? parseList(skillsText).map((skill) => <span key={skill}>{skill}</span>) : <p>Add a few skills to introduce yourself.</p>}</div></div><div className="profile-summary-section"><p className="dashboard-eyebrow">LOOKING TO LEARN</p><div className="profile-chips learning-chips">{parseList(goalsText).length ? parseList(goalsText).map((goal) => <span key={goal}>{goal}</span>) : <p>What would you like to learn next?</p>}</div></div></aside></div>}
      </div>
    </main>
  );
}