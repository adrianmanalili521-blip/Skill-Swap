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
  onSnapshot,
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

type View = "discover" | "listings" | "requests" | "profile";
type SkillLevel = "beginner" | "intermediate" | "advanced";
type SwapRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "completed";

interface UserProfile {
  displayName?: string;
  bio?: string;
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

interface SwapRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  skillId: string;
  offeredSkillId: string | null;
  message: string;
  status: SwapRequestStatus;
  createdAt?: { toMillis?: () => number };
}

interface SwapRequestSnapshotState {
  userId: string | null;
  incoming: SwapRequest[];
  outgoing: SwapRequest[];
  incomingLoaded: boolean;
  outgoingLoaded: boolean;
  error: string | null;
}

const categories = ["Art & Design", "Business", "Cooking", "Crafts", "Language", "Music", "Technology", "Wellness", "Other"];

function parseList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function createdTime(listing: SkillListing) {
  return listing.createdAt?.toMillis?.() ?? 0;
}

function requestCreatedTime(request: SwapRequest) {
  return request.createdAt?.toMillis?.() ?? 0;
}

export default function SprintTwoWorkspace() {
  const { user, loading, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [view, setView] = useState<View>("discover");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [listings, setListings] = useState<SkillListing[]>([]);
  const [requestSnapshot, setRequestSnapshot] = useState<SwapRequestSnapshotState>({
    userId: null,
    incoming: [],
    outgoing: [],
    incomingLoaded: false,
    outgoingLoaded: false,
    error: null,
  });
  const [bio, setBio] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [editing, setEditing] = useState<SkillListing | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [requestFormFor, setRequestFormFor] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingRequestFor, setSendingRequestFor] = useState<string | null>(null);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!user) return;
    const currentUserId = user.uid;
    let active = true;
    let incomingLoaded = false;
    let outgoingLoaded = false;

    function finishInitialLoad() {
      if (incomingLoaded && outgoingLoaded && active) {
        setRequestSnapshot((current) => current.userId === currentUserId
          ? { ...current, incomingLoaded: true, outgoingLoaded: true }
          : {
              userId: currentUserId,
              incoming: [],
              outgoing: [],
              incomingLoaded: true,
              outgoingLoaded: true,
              error: null,
            });
      }
    }

    const incomingUnsubscribe = onSnapshot(
      query(collection(db, "swapRequests"), where("toUserId", "==", currentUserId)),
      (snapshot) => {
        if (!active) return;
        const requests = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }) as SwapRequest)
          .sort((first, second) => requestCreatedTime(second) - requestCreatedTime(first));
        setRequestSnapshot((current) => {
          const previous = current.userId === currentUserId ? current : {
            userId: currentUserId,
            incoming: [],
            outgoing: [],
            incomingLoaded: false,
            outgoingLoaded: false,
            error: null,
          };
          return { ...previous, incoming: requests, incomingLoaded: true };
        });
        incomingLoaded = true;
        finishInitialLoad();
      },
      (listenerError) => {
        if (!active) return;
        const message = `Unable to load received swap requests: ${getAuthErrorMessage(listenerError)}`;
        setRequestSnapshot((current) => {
          const previous = current.userId === currentUserId ? current : {
            userId: currentUserId,
            incoming: [],
            outgoing: [],
            incomingLoaded: false,
            outgoingLoaded: false,
            error: null,
          };
          return { ...previous, incomingLoaded: true, error: previous.error ?? message };
        });
        incomingLoaded = true;
        finishInitialLoad();
      },
    );
    const outgoingUnsubscribe = onSnapshot(
      query(collection(db, "swapRequests"), where("fromUserId", "==", currentUserId)),
      (snapshot) => {
        if (!active) return;
        const requests = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }) as SwapRequest)
          .sort((first, second) => requestCreatedTime(second) - requestCreatedTime(first));
        setRequestSnapshot((current) => {
          const previous = current.userId === currentUserId ? current : {
            userId: currentUserId,
            incoming: [],
            outgoing: [],
            incomingLoaded: false,
            outgoingLoaded: false,
            error: null,
          };
          return { ...previous, outgoing: requests, outgoingLoaded: true };
        });
        outgoingLoaded = true;
        finishInitialLoad();
      },
      (listenerError) => {
        if (!active) return;
        const message = `Unable to load sent swap requests: ${getAuthErrorMessage(listenerError)}`;
        setRequestSnapshot((current) => {
          const previous = current.userId === currentUserId ? current : {
            userId: currentUserId,
            incoming: [],
            outgoing: [],
            incomingLoaded: false,
            outgoingLoaded: false,
            error: null,
          };
          return { ...previous, outgoingLoaded: true, error: previous.error ?? message };
        });
        outgoingLoaded = true;
        finishInitialLoad();
      },
    );

    return () => {
      active = false;
      incomingUnsubscribe();
      outgoingUnsubscribe();
    };
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
  const requestSnapshotIsCurrent = requestSnapshot.userId === user?.uid;
  const incomingRequests = requestSnapshotIsCurrent ? requestSnapshot.incoming : [];
  const outgoingRequests = requestSnapshotIsCurrent ? requestSnapshot.outgoing : [];
  const loadingRequests = !requestSnapshotIsCurrent || !requestSnapshot.incomingLoaded || !requestSnapshot.outgoingLoaded;
  const requestLoadError = requestSnapshotIsCurrent ? requestSnapshot.error : null;

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

  async function sendSwapRequest(listing: SkillListing, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || sendingRequestFor) return;
    setSendingRequestFor(listing.id); setError(null); setNotice(null);
    try {
      await addDoc(collection(db, "swapRequests"), {
        fromUserId: user.uid,
        toUserId: listing.ownerId,
        skillId: listing.id,
        offeredSkillId: null,
        message: requestMessage.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setRequestFormFor(null);
      setRequestMessage("");
      setNotice("Swap request sent.");
    } catch (requestError) { setError(getAuthErrorMessage(requestError)); }
    finally { setSendingRequestFor(null); }
  }

  async function updateSwapRequest(request: SwapRequest, status: "accepted" | "declined" | "cancelled") {
    if (processingRequestId) return;
    setProcessingRequestId(request.id); setError(null); setNotice(null);
    try {
      await updateDoc(doc(db, "swapRequests", request.id), { status, updatedAt: serverTimestamp() });
      setNotice(status === "accepted" ? "Swap request accepted." : status === "declined" ? "Swap request declined." : "Swap request cancelled.");
    } catch (requestError) { setError(getAuthErrorMessage(requestError)); }
    finally { setProcessingRequestId(null); }
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
          {(["discover", "listings", "requests", "profile"] as const).map((item) => <button key={item} className={view === item ? "dashboard-nav-item active" : "dashboard-nav-item"} type="button" onClick={() => { setView(item); setNotice(null); }}>{item === "listings" ? "My listings" : item === "requests" ? "Swap requests" : item === "discover" ? "Discover" : "Profile"}</button>)}
        </nav>
        <div className="dashboard-header-actions">
          <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}><span aria-hidden="true">{theme === "light" ? "◐" : "☀"}</span></button>
          <span className="dashboard-user-email">{user.email}</span>
          <button className="dashboard-signout" type="button" onClick={onSignOut} disabled={signingOut}>{signingOut ? "Signing out..." : "Sign out"}</button>
        </div>
      </header>
      <div className="dashboard-main">
        <section className="dashboard-welcome"><p className="dashboard-eyebrow">YOUR SKILL SWAP</p><h1>{view === "discover" ? "Find your next exchange." : view === "listings" ? "Share what you know." : view === "requests" ? "Make an exchange happen." : `Welcome, ${displayName}.`}</h1><h2 className="dashboard-welcome-test">testing production!</h2><p>{view === "discover" ? "Explore practical skills shared by your community." : view === "listings" ? "Create clear offers and keep your listings up to date." : view === "requests" ? "Track the requests you send and the offers you receive." : "A good exchange starts with a little context about you."}</p></section>
        {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}{notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}

        {view === "discover" && <section aria-label="Discover skills">
          <div className="discover-tools"><label className="search-field"><span className="search-icon" aria-hidden="true">⌕</span><span className="visually-hidden">Search skills, tags, or people</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search skills, tags, or people" /></label><label className="category-filter"><span className="visually-hidden">Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><button className="primary-action" type="button" onClick={() => { setEditing(null); setShowEditor(true); setView("listings"); }}><span aria-hidden="true">＋</span> Offer a skill</button></div>
          <div className="results-heading"><h2>Community skills</h2><span>{loadingData ? "Loading..." : `${discoveredListings.length} ${discoveredListings.length === 1 ? "listing" : "listings"}`}</span></div>
          {loadingData ? <div className="empty-state">Loading skills...</div> : discoveredListings.length ? <div className="skill-grid">{discoveredListings.map((listing, index) => {
            const previousRequest = outgoingRequests.find((request) => request.skillId === listing.id && (request.status === "pending" || request.status === "accepted"));
            const requestFormOpen = requestFormFor === listing.id;
            return <article className="skill-card" key={listing.id} style={{ animationDelay: `${Math.min(index * 45, 270)}ms` }}><div className="skill-card-topline"><span className="skill-category">{listing.category}</span><span className="skill-level">{listing.level}</span></div><h3>{listing.title}</h3><p className="skill-description">{listing.description || "This member is happy to share what they know."}</p>{listing.tags.length > 0 && <div className="skill-tags">{listing.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>}<div className="skill-card-footer"><Link href={`/profile/${listing.ownerId}`} className="listing-owner"><span className="mini-avatar">{listing.ownerName.slice(0, 1).toUpperCase()}</span><span>{listing.ownerName}</span></Link><span className="listing-status">Open to swap</span></div>
              {previousRequest ? <p className="request-existing-status">Request {previousRequest.status}</p> : requestFormOpen ? <form className="swap-request-form" onSubmit={(event) => void sendSwapRequest(listing, event)}><label className="dashboard-field"><span>Message <small>Optional</small></span><textarea value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} maxLength={500} rows={3} placeholder="What would you like to learn?" /></label><div className="editor-actions"><button className="secondary-action" type="button" onClick={() => { setRequestFormFor(null); setRequestMessage(""); }}>Cancel</button><button className="primary-action" type="submit" disabled={sendingRequestFor !== null}>{sendingRequestFor === listing.id ? "Sending..." : "Send request"}</button></div></form> : <button className="secondary-action request-start" type="button" disabled={loadingRequests} onClick={() => { setRequestFormFor(listing.id); setRequestMessage(""); }}>{loadingRequests ? "Loading requests..." : outgoingRequests.some((request) => request.skillId === listing.id && request.status === "declined") ? "Request again" : "Request a swap"}</button>}
            </article>;
          })}</div> : <div className="empty-state"><strong>No matching skills yet.</strong><span>Try another search, or be the first to share a skill.</span></div>}
        </section>}

        {view === "requests" && <section className="swap-requests-view" aria-label="Swap requests">
          {loadingRequests ? <div className="empty-state">Loading swap requests...</div> : requestLoadError ? <div className="empty-state" role="alert"><strong>Requests are unavailable.</strong><span>{requestLoadError}</span></div> : <>
            <section className="request-group" aria-labelledby="incoming-requests-heading"><div className="results-heading"><h2 id="incoming-requests-heading">Received</h2><span>{incomingRequests.length} {incomingRequests.length === 1 ? "request" : "requests"}</span></div>
              {incomingRequests.length ? <div className="request-list">{incomingRequests.map((request) => <article className="request-card" key={request.id}><div className="request-card-heading"><div><p className="dashboard-eyebrow">REQUEST RECEIVED</p><h3>{listings.find((listing) => listing.id === request.skillId)?.title ?? "Skill listing"}</h3></div><span className={`request-status ${request.status}`}>{request.status}</span></div><p className="request-participant">From a <Link href={`/profile/${request.fromUserId}`}>community member</Link></p>{request.message && <p className="request-message">{request.message}</p>}{request.status === "pending" && <div className="request-actions"><button className="secondary-action" type="button" disabled={processingRequestId !== null} onClick={() => void updateSwapRequest(request, "declined")}>Decline</button><button className="primary-action" type="button" disabled={processingRequestId !== null} onClick={() => void updateSwapRequest(request, "accepted")}>{processingRequestId === request.id ? "Saving..." : "Accept"}</button></div>}</article>)}</div> : <div className="empty-state"><strong>No requests received.</strong><span>When someone requests one of your skills, it will appear here.</span></div>}
            </section>
            <section className="request-group" aria-labelledby="outgoing-requests-heading"><div className="results-heading"><h2 id="outgoing-requests-heading">Sent</h2><span>{outgoingRequests.length} {outgoingRequests.length === 1 ? "request" : "requests"}</span></div>
              {outgoingRequests.length ? <div className="request-list">{outgoingRequests.map((request) => <article className="request-card" key={request.id}><div className="request-card-heading"><div><p className="dashboard-eyebrow">REQUEST SENT</p><h3>{listings.find((listing) => listing.id === request.skillId)?.title ?? "Skill listing"}</h3></div><span className={`request-status ${request.status}`}>{request.status}</span></div><p className="request-participant">To a <Link href={`/profile/${request.toUserId}`}>community member</Link></p>{request.message && <p className="request-message">{request.message}</p>}{request.status === "pending" && <div className="request-actions"><button className="secondary-action destructive-action" type="button" disabled={processingRequestId !== null} onClick={() => void updateSwapRequest(request, "cancelled")}>{processingRequestId === request.id ? "Saving..." : "Cancel request"}</button></div>}</article>)}</div> : <div className="empty-state"><strong>No requests sent.</strong><span>Explore the community and request a skill to get started.</span></div>}
            </section>
          </>}
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