"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { SkillSwapLogo } from "@/components/skill-swap-logo";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { useTheme } from "@/lib/theme-context";
import { DEFAULT_SKILL_DURATION_MINUTES, formatSkillPrice } from "@/lib/skill-listing-format";

interface PublicProfile { displayName?: string; bio?: string; skillsOffered?: string[]; learningGoals?: string[]; rating?: number; ratingCount?: number; completedExchangeCount?: number; verified?: boolean; }
interface PublicListing { id: string; ownerId: string; title: string; description: string; category: string; level: string; status: string; durationMinutes?: number; price?: number | null; createdAt?: { toMillis?: () => number }; }

const PROFILE_LISTING_PAGE_SIZE = 12;

export default function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [listings, setListings] = useState<PublicListing[]>([]);
  const [listingSort, setListingSort] = useState<"newest" | "oldest">("newest");
  const [listingPage, setListingPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, router, user]);
  useEffect(() => {
    if (!user || !userId) return;
    let active = true;
    async function loadProfile() {
      setBusy(true);
      try {
        const [profileSnapshot, skillsSnapshot] = await Promise.all([
          getDoc(doc(db, "users", userId)),
          getDocs(query(collection(db, "skills"), where("ownerId", "==", userId))),
        ]);
        if (!profileSnapshot.exists()) throw new Error("This profile could not be found.");
        if (!active) return;
        setProfile(profileSnapshot.data() as PublicProfile);
        setListings(skillsSnapshot.docs
          .map((skillDoc) => ({ id: skillDoc.id, ...skillDoc.data() }) as PublicListing)
          .filter((listing) => listing.status === "active")
          .sort((first, second) => (second.createdAt?.toMillis?.() ?? 0) - (first.createdAt?.toMillis?.() ?? 0)));
        setListingPage(0);
      } catch (loadError) { if (active) setError(getAuthErrorMessage(loadError)); }
      finally { if (active) setBusy(false); }
    }
    void loadProfile();
    return () => { active = false; };
  }, [user, userId]);

  const sortedListings = [...listings].sort((first, second) =>
    (listingSort === "newest" ? -1 : 1)
      * ((first.createdAt?.toMillis?.() ?? 0) - (second.createdAt?.toMillis?.() ?? 0)));
  const pageCount = Math.ceil(sortedListings.length / PROFILE_LISTING_PAGE_SIZE);
  const currentPage = Math.min(listingPage, Math.max(0, pageCount - 1));
  const visibleListings = sortedListings.slice(
    currentPage * PROFILE_LISTING_PAGE_SIZE,
    (currentPage + 1) * PROFILE_LISTING_PAGE_SIZE,
  );

  if (loading || !user || busy) return <main className="dashboard-loading" role="status"><span className="loading-indicator" /><span>Loading profile</span></main>;
  return <main className="dashboard-shell public-profile-shell" data-theme={theme}>
    <header className="dashboard-header"><Link className="dashboard-brand" href="/dashboard"><SkillSwapLogo /></Link><Link className="back-link" href="/dashboard">← Back to discovery</Link></header>
    <div className="public-profile-main">{error || !profile ? <p className="dashboard-message dashboard-error" role="alert">{error ?? "This profile could not be found."}</p> : <>
      <section className="public-profile-intro"><span className="profile-avatar public-avatar" aria-hidden="true">{(profile.displayName ?? "S").slice(0, 1).toUpperCase()}</span><div><p className="dashboard-eyebrow">COMMUNITY PROFILE</p><h1>{profile.displayName || "Skill Swap member"} {profile.verified && <span className="verified-badge" title="Identity checked by an administrator">Verified</span>}</h1><p>{profile.bio || "This member is ready to share and learn."}</p><p className="public-profile-reputation">{profile.completedExchangeCount ?? 0} completed exchanges · {profile.ratingCount ? `${(profile.rating ?? 0).toFixed(1)} ★ (${profile.ratingCount} reviews)` : "No reviews yet"}</p>{user.uid !== userId && <Link className="admin-text-button" href={`/report/user/${encodeURIComponent(userId)}`}>Report this member</Link>}</div></section>
      <section className="public-profile-listings"><div className="results-heading"><h2>Skills offered</h2><span>{listings.length} {listings.length === 1 ? "listing" : "listings"}</span><label className="category-filter"><span className="visually-hidden">Sort listings</span><select value={listingSort} onChange={(event) => { setListingSort(event.target.value as typeof listingSort); setListingPage(0); }}><option value="newest">Latest first</option><option value="oldest">Oldest first</option></select></label></div>{listings.length ? <><div className="skill-grid">{visibleListings.map((listing) => <article className="skill-card" key={listing.id}><div className="skill-card-topline"><span className="skill-category">{listing.category}</span><span className="skill-level">{listing.level}</span></div><h3>{listing.title}</h3><p className="skill-description">{listing.description || "This member is happy to share what they know."}</p><p className="skill-listing-meta">{listing.durationMinutes ?? DEFAULT_SKILL_DURATION_MINUTES} minutes | {formatSkillPrice(listing.price)}</p></article>)}</div>{pageCount > 1 && <div className="discovery-pagination"><span>{currentPage * PROFILE_LISTING_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PROFILE_LISTING_PAGE_SIZE, listings.length)} of {listings.length}</span><div><button className="secondary-action" type="button" disabled={currentPage === 0} onClick={() => setListingPage(Math.max(0, currentPage - 1))}>Previous</button><button className="secondary-action" type="button" disabled={currentPage >= pageCount - 1} onClick={() => setListingPage(Math.min(pageCount - 1, currentPage + 1))}>Next</button></div></div>}</> : <div className="empty-state">No active skill listings yet.</div>}</section>
      <section className="public-profile-tags"><div><p className="dashboard-eyebrow">SKILLS I OFFER</p><div className="profile-chips">{(profile.skillsOffered ?? []).map((skill) => <span key={skill}>{skill}</span>)}</div></div><div><p className="dashboard-eyebrow">LOOKING TO LEARN</p><div className="profile-chips learning-chips">{(profile.learningGoals ?? []).map((goal) => <span key={goal}>{goal}</span>)}</div></div></section>
    </>}</div>
  </main>;
}