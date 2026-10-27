"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc, getDocs, collection, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { useTheme } from "@/lib/theme-context";

type AdminTab = "users" | "listings";
type UserStatus = "active" | "suspended";
type ListingStatus = "active" | "paused" | "removed";

interface AdminUser {
  id: string;
  displayName?: string;
  email?: string;
  role?: string;
  status?: UserStatus;
  createdAt?: { toMillis?: () => number };
}

interface AdminListing {
  id: string;
  ownerId: string;
  ownerName?: string;
  title?: string;
  description?: string;
  category?: string;
  status?: ListingStatus;
  createdAt?: { toMillis?: () => number };
}

function createdTime(value: { createdAt?: { toMillis?: () => number } }) {
  return value.createdAt?.toMillis?.() ?? 0;
}

export default function AdminPage() {
  const { user, loading, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [tab, setTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [search, setSearch] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    if (loading || !user) return;
    const currentUser = user;
    let active = true;
    async function checkAdminAccess() {
      setCheckingAccess(true);
      setError(null);
      try {
        const profile = await getDoc(doc(db, "users", currentUser.uid));
        if (!profile.exists() || profile.data().role !== "admin") {
          if (active) router.replace("/dashboard");
          return;
        }
        if (active) setAuthorized(true);
      } catch (accessError) {
        if (active) setError(getAuthErrorMessage(accessError));
      } finally {
        if (active) setCheckingAccess(false);
      }
    }
    void checkAdminAccess();
    return () => { active = false; };
  }, [loading, router, user]);

  useEffect(() => {
    if (!authorized) return;
    let active = true;
    async function loadModerationData() {
      setLoadingData(true);
      setError(null);
      try {
        const [userSnapshot, listingSnapshot] = await Promise.all([
          getDocs(collection(db, "users")),
          getDocs(collection(db, "skills")),
        ]);
        if (!active) return;
        setUsers(userSnapshot.docs
          .map((userDoc) => ({ id: userDoc.id, ...userDoc.data() }) as AdminUser)
          .sort((first, second) => createdTime(second) - createdTime(first)));
        setListings(listingSnapshot.docs
          .map((listingDoc) => ({ id: listingDoc.id, ...listingDoc.data() }) as AdminListing)
          .sort((first, second) => createdTime(second) - createdTime(first)));
      } catch (loadError) {
        if (active) setError(getAuthErrorMessage(loadError));
      } finally {
        if (active) setLoadingData(false);
      }
    }
    void loadModerationData();
    return () => { active = false; };
  }, [authorized]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((member) => !term || [member.displayName, member.email, member.id]
      .some((value) => value?.toLowerCase().includes(term)));
  }, [search, users]);
  const filteredListings = useMemo(() => {
    const term = search.trim().toLowerCase();
    return listings.filter((listing) => !term || [
      listing.title, listing.description, listing.category, listing.ownerName, listing.ownerId,
    ].some((value) => value?.toLowerCase().includes(term)));
  }, [listings, search]);
  const activeUsers = users.filter((member) => member.status !== "suspended").length;
  const suspendedUsers = users.length - activeUsers;
  const activeListings = listings.filter((listing) => listing.status === "active").length;
  const removedListings = listings.filter((listing) => listing.status === "removed").length;

  async function setUserStatus(member: AdminUser, status: UserStatus) {
    if (!user || member.id === user.uid || member.role === "admin") return;
    const action = status === "suspended" ? "Suspend" : "Reactivate";
    if (!window.confirm(`${action} ${member.displayName || member.email || "this user"}?`)) return;
    setSavingId(member.id);
    setError(null);
    setNotice(null);
    try {
      await updateDoc(doc(db, "users", member.id), { status, updatedAt: serverTimestamp() });
      setUsers((current) => current.map((item) => item.id === member.id ? { ...item, status } : item));
      setNotice(status === "suspended" ? "User suspended. Their Firestore access is now blocked." : "User reactivated.");
    } catch (updateError) {
      setError(getAuthErrorMessage(updateError));
    } finally {
      setSavingId(null);
    }
  }

  async function setListingStatus(listing: AdminListing, status: ListingStatus) {
    const action = status === "removed" ? "Remove" : status === "paused" ? "Pause" : "Restore";
    if (!window.confirm(`${action} “${listing.title || "this listing"}”?`)) return;
    setSavingId(listing.id);
    setError(null);
    setNotice(null);
    try {
      await updateDoc(doc(db, "skills", listing.id), { status, updatedAt: serverTimestamp() });
      setListings((current) => current.map((item) => item.id === listing.id ? { ...item, status } : item));
      setNotice(`Listing ${status === "removed" ? "removed" : status === "paused" ? "paused" : "restored"}.`);
    } catch (updateError) {
      setError(getAuthErrorMessage(updateError));
    } finally {
      setSavingId(null);
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

  async function handleThemeToggle() {
    try {
      await toggleTheme();
    } catch (toggleError) {
      setError(getAuthErrorMessage(toggleError));
    }
  }

  if (loading || !user || checkingAccess) {
    return <main className="dashboard-loading" role="status"><span className="loading-indicator" /><span>Checking administrator access</span></main>;
  }

  if (!authorized) {
    return <main className="dashboard-loading">
      <div role={error ? "alert" : "status"}>{error ?? "Returning to the dashboard."}</div>
      <Link className="back-link" href="/dashboard">Back to dashboard</Link>
    </main>;
  }

  return (
    <main className="dashboard-shell admin-shell" data-theme={theme}>
      <header className="dashboard-header">
        <Link className="dashboard-brand" href="/dashboard"><span className="dashboard-brand-mark" aria-hidden="true">s</span><span>skill swap</span></Link>
        <nav className="dashboard-nav" aria-label="Admin navigation">
          <span className="dashboard-nav-item active">Admin panel</span>
          <Link className="admin-back-link" href="/dashboard">Back to dashboard</Link>
        </nav>
        <div className="dashboard-header-actions">
          <button className="theme-toggle" type="button" onClick={() => void handleThemeToggle()} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}><span aria-hidden="true">{theme === "light" ? "◐" : "☀"}</span></button>
          <span className="dashboard-user-email">{user.email}</span>
          <button className="dashboard-signout" type="button" onClick={() => void handleSignOut()} disabled={signingOut}>{signingOut ? "Signing out..." : "Sign out"}</button>
        </div>
      </header>

      <div className="dashboard-main admin-main">
        <section className="dashboard-welcome">
          <p className="dashboard-eyebrow">COMMUNITY OPERATIONS</p>
          <h1>Admin dashboard.</h1>
          <p>Review member accounts and keep skill listings safe for the community.</p>
        </section>
        {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
        {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}

        <section className="admin-stats" aria-label="Moderation overview">
          <article className="admin-stat"><span>Active members</span><strong>{activeUsers}</strong></article>
          <article className="admin-stat"><span>Suspended members</span><strong>{suspendedUsers}</strong></article>
          <article className="admin-stat"><span>Active listings</span><strong>{activeListings}</strong></article>
          <article className="admin-stat"><span>Removed listings</span><strong>{removedListings}</strong></article>
        </section>

        <section className="admin-workspace" aria-label="Moderation tools">
          <div className="admin-toolbar">
            <div className="admin-tabs" role="tablist" aria-label="Moderation type">
              <button type="button" role="tab" aria-selected={tab === "users"} className={tab === "users" ? "admin-tab active" : "admin-tab"} onClick={() => { setTab("users"); setSearch(""); }}>Users <span>{users.length}</span></button>
              <button type="button" role="tab" aria-selected={tab === "listings"} className={tab === "listings" ? "admin-tab active" : "admin-tab"} onClick={() => { setTab("listings"); setSearch(""); }}>Skill listings <span>{listings.length}</span></button>
            </div>
            <label className="admin-search"><span className="visually-hidden">Search moderation records</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "users" ? "Search name, email, or ID" : "Search listing or owner"} /></label>
          </div>

          {loadingData ? <div className="empty-state" role="status">Loading moderation records...</div> : tab === "users" ? (
            filteredUsers.length ? <div className="admin-record-list">{filteredUsers.map((member) => {
              const status = member.status === "suspended" ? "suspended" : "active";
              const isProtectedAccount = member.id === user.uid || member.role === "admin";
              return <article className="admin-record" key={member.id}>
                <div className="admin-record-copy">
                  <div className="admin-record-title"><h2>{member.displayName || "Unnamed member"}</h2><span className={`admin-status ${status}`}>{member.role === "admin" ? "admin" : status}</span></div>
                  <p>{member.email || "No email"} <span aria-hidden="true">·</span> <code>{member.id}</code></p>
                </div>
                {isProtectedAccount ? <span className="admin-protected-label">{member.id === user.uid ? "Your account" : "Administrator"}</span> : <button className={status === "suspended" ? "secondary-action" : "secondary-action admin-danger-action"} type="button" disabled={savingId === member.id} onClick={() => void setUserStatus(member, status === "suspended" ? "active" : "suspended")}>{savingId === member.id ? "Saving..." : status === "suspended" ? "Reactivate" : "Suspend"}</button>}
              </article>;
            })}</div> : <div className="empty-state"><strong>No members found.</strong><span>Try a different search.</span></div>
          ) : filteredListings.length ? (
            <div className="admin-record-list">{filteredListings.map((listing) => {
              const status = listing.status ?? "active";
              return <article className="admin-record admin-listing-record" key={listing.id}>
                <div className="admin-record-copy">
                  <div className="admin-record-title"><h2>{listing.title || "Untitled listing"}</h2><span className={`admin-status ${status}`}>{status}</span></div>
                  <p>{listing.category || "Uncategorized"} <span aria-hidden="true">·</span> By {listing.ownerName || listing.ownerId}</p>
                  {listing.description && <p className="admin-listing-description">{listing.description}</p>}
                </div>
                <div className="admin-record-actions">
                  {status === "removed" ? <button className="secondary-action" type="button" disabled={savingId === listing.id} onClick={() => void setListingStatus(listing, "active")}>{savingId === listing.id ? "Saving..." : "Restore"}</button> : <>
                    <button className="secondary-action" type="button" disabled={savingId === listing.id} onClick={() => void setListingStatus(listing, status === "paused" ? "active" : "paused")}>{savingId === listing.id ? "Saving..." : status === "paused" ? "Activate" : "Pause"}</button>
                    <button className="secondary-action admin-danger-action" type="button" disabled={savingId === listing.id} onClick={() => void setListingStatus(listing, "removed")}>Remove</button>
                  </>}
                </div>
              </article>;
            })}</div>
          ) : <div className="empty-state"><strong>No listings found.</strong><span>Try a different search.</span></div>}
        </section>
      </div>
    </main>
  );
}
