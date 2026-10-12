"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { useTheme } from "@/lib/theme-context";

interface PublicProfile { displayName?: string; bio?: string; skillsOffered?: string[]; learningGoals?: string[]; }
interface PublicListing { id: string; ownerId: string; title: string; description: string; category: string; level: string; status: string; }

export default function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [listings, setListings] = useState<PublicListing[]>([]);
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
        setListings(skillsSnapshot.docs.map((skillDoc) => ({ id: skillDoc.id, ...skillDoc.data() }) as PublicListing).filter((listing) => listing.status === "active"));
      } catch (loadError) { if (active) setError(getAuthErrorMessage(loadError)); }
      finally { if (active) setBusy(false); }
    }
    void loadProfile();
    return () => { active = false; };
  }, [user, userId]);

  if (loading || !user || busy) return <main className="dashboard-loading" role="status"><span className="loading-indicator" /><span>Loading profile</span></main>;
  return <main className="dashboard-shell public-profile-shell" data-theme={theme}>
    <header className="dashboard-header"><Link className="dashboard-brand" href="/dashboard"><span className="dashboard-brand-mark" aria-hidden="true">s</span><span>skill swap</span></Link><Link className="back-link" href="/dashboard">← Back to discovery</Link></header>
    <div className="public-profile-main">{error || !profile ? <p className="dashboard-message dashboard-error" role="alert">{error ?? "This profile could not be found."}</p> : <>
      <section className="public-profile-intro"><span className="profile-avatar public-avatar" aria-hidden="true">{(profile.displayName ?? "S").slice(0, 1).toUpperCase()}</span><div><p className="dashboard-eyebrow">COMMUNITY PROFILE</p><h1>{profile.displayName || "Skill Swap member"}</h1><p>{profile.bio || "This member is ready to share and learn."}</p></div></section>
      <section className="public-profile-listings"><div className="results-heading"><h2>Skills offered</h2><span>{listings.length} {listings.length === 1 ? "listing" : "listings"}</span></div>{listings.length ? <div className="skill-grid">{listings.map((listing) => <article className="skill-card" key={listing.id}><div className="skill-card-topline"><span className="skill-category">{listing.category}</span><span className="skill-level">{listing.level}</span></div><h3>{listing.title}</h3><p className="skill-description">{listing.description || "This member is happy to share what they know."}</p></article>)}</div> : <div className="empty-state">No active skill listings yet.</div>}</section>
      <section className="public-profile-tags"><div><p className="dashboard-eyebrow">SKILLS I OFFER</p><div className="profile-chips">{(profile.skillsOffered ?? []).map((skill) => <span key={skill}>{skill}</span>)}</div></div><div><p className="dashboard-eyebrow">LOOKING TO LEARN</p><div className="profile-chips learning-chips">{(profile.learningGoals ?? []).map((goal) => <span key={goal}>{goal}</span>)}</div></div></section>
    </>}</div>
  </main>;
}