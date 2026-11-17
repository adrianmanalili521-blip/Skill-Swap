"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type WriteBatch,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { db, storage } from "@/lib/firebase";
import { deleteObject, getBlob, ref as storageRef } from "firebase/storage";
import { useTheme } from "@/lib/theme-context";
import { DEFAULT_SKILL_DURATION_MINUTES, formatSkillPrice } from "@/lib/skill-listing-format";

type Section =
  | "overview"
  | "users"
  | "listings"
  | "swaps"
  | "exchanges"
  | "categories"
  | "reports"
  | "verification"
  | "notifications"
  | "analytics"
  | "activity"
  | "settings";
type AccountStatus = "active" | "suspended";
type ListingStatus = "active" | "paused" | "removed";
type SwapStatus = "pending" | "accepted" | "declined" | "cancelled" | "completed";
type ReportStatus = "pending" | "under_review" | "resolved" | "dismissed";
type Interval = "daily" | "weekly" | "monthly" | "yearly";
type TimeValue = { toMillis?: () => number };

interface AdminUser {
  id: string;
  displayName?: string;
  email?: string;
  role?: string;
  status?: AccountStatus;
  createdAt?: TimeValue;
}

interface AdminListing {
  id: string;
  ownerId: string;
  ownerName?: string;
  title?: string;
  description?: string;
  category?: string;
  status?: ListingStatus;
  durationMinutes?: number;
  price?: number | null;
  createdAt?: TimeValue;
}

interface AdminSwap {
  id: string;
  fromUserId: string;
  toUserId: string;
  skillId: string;
  offeredSkillId?: string | null;
  status: SwapStatus;
  createdAt?: TimeValue;
}

interface AdminCategory {
  id: string;
  name: string;
  description?: string;
  status: "active" | "inactive";
  createdAt?: TimeValue;
  updatedAt?: TimeValue;
}

interface AdminCategoryRequest {
  id: string;
  requesterId: string;
  requesterName?: string;
  name: string;
  reason?: string;
  status: "pending" | "approved" | "declined";
  createdAt?: TimeValue;
}

interface AdminReport {
  id: string;
  reporterId: string;
  reporterName?: string;
  targetType: "user" | "listing";
  targetId: string;
  targetName?: string;
  reason: string;
  status: ReportStatus;
  resolutionNote?: string;
  createdAt?: TimeValue;
  updatedAt?: TimeValue;
}

interface AdminNotification {
  id: string;
  kind: string;
  actorId: string;
  requestId: string;
  read: boolean;
  createdAt?: TimeValue;
}

interface AdminLog {
  id: string;
  actorId: string;
  actorName?: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt?: TimeValue;
}

interface AdminVerification {
  id: string;
  userId: string;
  storagePath: string;
  documentName: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "approved" | "rejected";
  storageDeleted?: boolean;
  reviewNote?: string;
  createdAt?: TimeValue;
}

interface ChartBucket {
  key: string;
  label: string;
  start: number;
  users: number;
  listings: number;
  swaps: number;
}

const navigation: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "users", label: "User management", icon: "◉" },
  { id: "listings", label: "Skill listings", icon: "▤" },
  { id: "swaps", label: "Swap requests", icon: "⇄" },
  { id: "exchanges", label: "Exchange activity", icon: "↔" },
  { id: "categories", label: "Categories", icon: "◈" },
  { id: "reports", label: "Reports & moderation", icon: "⚑" },
  { id: "verification", label: "ID verification", icon: "✓" },
  { id: "notifications", label: "Notifications", icon: "♧" },
  { id: "analytics", label: "Analytics & reports", icon: "▥" },
  { id: "activity", label: "Admin activity logs", icon: "◷" },
  { id: "settings", label: "System settings", icon: "⚙" },
];

const defaultCategories = [
  "Art & Design", "Business", "Cooking", "Crafts", "Language",
  "Music", "Technology", "Wellness", "Other",
];

const REPORT_STATUSES: ReportStatus[] = ["pending", "under_review", "resolved", "dismissed"];

function fromSnapshot<T extends { id: string }>(snapshot: QuerySnapshot<DocumentData>): T[] {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T);
}

function timeOf(value?: { createdAt?: TimeValue }) {
  return value?.createdAt?.toMillis?.() ?? 0;
}

function formatDate(value?: TimeValue) {
  const milliseconds = value?.toMillis?.();
  return milliseconds ? new Date(milliseconds).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  }) : "—";
}

function formatDateTime(value?: TimeValue) {
  const milliseconds = value?.toMillis?.();
  return milliseconds ? new Date(milliseconds).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) : "—";
}

function categoryKey(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function makeBuckets(interval: Interval, now: Date): ChartBucket[] {
  if (interval === "monthly") {
    return Array.from({ length: 12 }, (_, index) => {
      const start = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
      const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      return {
        key,
        label: start.toLocaleDateString(undefined, { month: "short" }),
        start: start.getTime(),
        users: 0, listings: 0, swaps: 0,
      };
    });
  }
  if (interval === "yearly") {
    return Array.from({ length: 5 }, (_, index) => {
      const year = now.getFullYear() - 4 + index;
      return {
        key: String(year), label: String(year), start: new Date(year, 0, 1).getTime(),
        users: 0, listings: 0, swaps: 0,
      };
    });
  }
  const count = interval === "daily" ? 30 : 12;
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(now);
    if (interval === "daily") {
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (count - index - 1));
    } else {
      const day = start.getDay();
      start.setDate(start.getDate() - ((day + 6) % 7) - 7 * (count - index - 1));
      start.setHours(0, 0, 0, 0);
    }
    return {
      key: start.toISOString().slice(0, 10),
      label: interval === "daily"
        ? start.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
        : start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      start: start.getTime(), users: 0, listings: 0, swaps: 0,
    };
  });
}

function dateBucketKey(milliseconds: number, interval: Interval) {
  const date = new Date(milliseconds);
  if (interval === "yearly") return String(date.getFullYear());
  if (interval === "monthly") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  if (interval === "daily") return date.toISOString().slice(0, 10);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function addActivity(
  batch: WriteBatch,
  admin: User,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  batch.set(doc(collection(db, "adminActivityLogs")), {
    actorId: admin.uid,
    actorName: admin.displayName || admin.email || "Administrator",
    action,
    entityType,
    entityId,
    summary,
    before,
    after,
    createdAt: serverTimestamp(),
  });
}

function includesTerm(values: (string | undefined)[], term: string) {
  return !term || values.some((value) => value?.toLowerCase().includes(term));
}

export default function AdminDashboard() {
  const { user, loading, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [section, setSection] = useState<Section>("overview");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [swaps, setSwaps] = useState<AdminSwap[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [categoryRequests, setCategoryRequests] = useState<AdminCategoryRequest[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [verifications, setVerifications] = useState<AdminVerification[]>([]);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [activity, setActivity] = useState<AdminLog[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [userSort, setUserSort] = useState("newest");
  const [categorySort, setCategorySort] = useState<"newest" | "oldest">("newest");
  const [categoryRequestSort, setCategoryRequestSort] = useState<"newest" | "oldest">("newest");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [page, setPage] = useState(0);
  const [categoryPage, setCategoryPage] = useState(0);
  const [categoryRequestPage, setCategoryRequestPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null);
  const [reportDrafts, setReportDrafts] = useState<Record<string, ReportStatus>>({});
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const [signingOut, setSigningOut] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [nowMilliseconds, setNowMilliseconds] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    if (loading || !user) return;
    const currentUser = user;
    let active = true;
    async function verifyAdmin() {
      setCheckingAccess(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/admin/verify", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) {
          if (active) {
            setAuthorized(false);
            if (response.status === 403) router.replace("/dashboard");
            else setError("Administrator access could not be verified. Please sign in again.");
          }
          return;
        }
        if (active) setAuthorized(true);
      } catch (verificationError) {
        if (active) setError(getAuthErrorMessage(verificationError));
      } finally {
        if (active) setCheckingAccess(false);
      }
    }
    void verifyAdmin();
    return () => { active = false; };
  }, [loading, router, user]);

  const loadData = useCallback(async () => {
    if (!authorized) return;
    setLoadingData(true);
    setError(null);
    try {
      const [userDocs, listingDocs, swapDocs, categoryDocs, categoryRequestDocs,
        reportDocs, verificationDocs, notificationDocs, activityDocs] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "skills")),
        getDocs(collection(db, "swapRequests")),
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "categoryRequests")),
        getDocs(collection(db, "reports")),
        getDocs(collection(db, "idVerifications")),
        user ? getDocs(query(collection(db, "notifications"), where("recipientId", "==", user.uid))) : Promise.resolve(null),
        getDocs(collection(db, "adminActivityLogs")),
      ]);
      setUsers(fromSnapshot<AdminUser>(userDocs).sort((a, b) => timeOf(b) - timeOf(a)));
      setListings(fromSnapshot<AdminListing>(listingDocs).sort((a, b) => timeOf(b) - timeOf(a)));
      setSwaps(fromSnapshot<AdminSwap>(swapDocs).sort((a, b) => timeOf(b) - timeOf(a)));
      setCategories(fromSnapshot<AdminCategory>(categoryDocs).sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryRequests(fromSnapshot<AdminCategoryRequest>(categoryRequestDocs).sort((a, b) => timeOf(b) - timeOf(a)));
      setReports(fromSnapshot<AdminReport>(reportDocs).sort((a, b) => timeOf(b) - timeOf(a)));
      setVerifications(fromSnapshot<AdminVerification>(verificationDocs).sort((a, b) => timeOf(b) - timeOf(a)));
      setNotifications(notificationDocs ? fromSnapshot<AdminNotification>(notificationDocs)
        .sort((a, b) => timeOf(b) - timeOf(a)) : []);
      setActivity(fromSnapshot<AdminLog>(activityDocs).sort((a, b) => timeOf(b) - timeOf(a)));
    } catch (loadError) {
      const permissionDenied = typeof loadError === "object" && loadError !== null
        && "code" in loadError && loadError.code === "permission-denied";
      setError(permissionDenied
        ? "Firestore denied administrator data access. Check that the signed-in account has an active admin role and deploy the current Firestore rules."
        : getAuthErrorMessage(loadError));
    } finally {
      setLoadingData(false);
    }
  }, [authorized, user]);

  useEffect(() => {
    if (!authorized) return;
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authorized, loadData]);

  useEffect(() => {
    const timer = window.setTimeout(() => setNowMilliseconds(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const startOfWeek = useMemo(() => {
    const start = new Date(nowMilliseconds);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start.getTime();
  }, [nowMilliseconds]);
  const startOfMonth = useMemo(() => {
    const date = new Date(nowMilliseconds);
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }, [nowMilliseconds]);
  const activeUsers = users.filter((member) => member.status !== "suspended").length;
  const suspendedUsers = users.length - activeUsers;
  const pendingSwaps = swaps.filter((swap) => swap.status === "pending").length;
  const completedSwaps = swaps.filter((swap) => swap.status === "completed").length;
  const cancelledSwaps = swaps.filter((swap) => swap.status === "cancelled" || swap.status === "declined").length;
  const pendingReports = reports.filter((report) => report.status === "pending").length;
  const pendingVerifications = verifications.filter((verification) => verification.status === "pending").length;
  const activeListings = listings.filter((listing) => (listing.status ?? "active") === "active").length;
  const knownCategoryNames = new Set(categories.map((category) => category.name.trim().toLowerCase()));
  const legacyCategories = categoryRequests.filter((request) =>
    request.status === "approved" && !knownCategoryNames.has(request.name.trim().toLowerCase()));
  const memberById = useMemo(() => new Map(users.map((member) => [member.id, member])), [users]);
  const listingById = useMemo(() => new Map(listings.map((listing) => [listing.id, listing])), [listings]);

  const filteredUsers = users.filter((member) =>
    (statusFilter === "all" || (member.status ?? "active") === statusFilter)
    && (dateFilter === "all" || timeOf(member) >= nowMilliseconds - Number(dateFilter) * 24 * 60 * 60 * 1000)
    && includesTerm([member.displayName, member.email, member.id, member.role], normalizedSearch));
  const filteredListings = listings.filter((listing) =>
    (statusFilter === "all" || (listing.status ?? "active") === statusFilter)
    && (categoryFilter === "all" || listing.category === categoryFilter)
    && includesTerm([listing.title, listing.description, listing.category, listing.ownerName, listing.ownerId], normalizedSearch));
  const filteredSwaps = swaps.filter((swap) =>
    (statusFilter === "all" || swap.status === statusFilter)
    && (dateFilter === "all" || timeOf(swap) >= nowMilliseconds - Number(dateFilter) * 24 * 60 * 60 * 1000)
    && includesTerm([swap.id, swap.fromUserId, swap.toUserId, swap.status], normalizedSearch));
  const filteredExchanges = swaps.filter((swap) =>
    (swap.status === "accepted" || swap.status === "completed")
    && (dateFilter === "all" || timeOf(swap) >= nowMilliseconds - Number(dateFilter) * 24 * 60 * 60 * 1000)
    && includesTerm([swap.id, swap.fromUserId, swap.toUserId, swap.status,
      listingById.get(swap.skillId)?.title], normalizedSearch));
  const filteredReports = reports.filter((report) =>
    (statusFilter === "all" || report.status === statusFilter)
    && includesTerm([report.targetName, report.targetId, report.reporterName, report.reporterId,
      report.reason, report.status, report.targetType], normalizedSearch));
  const filteredVerifications = verifications.filter((verification) =>
    (statusFilter === "all" || verification.status === statusFilter)
    && includesTerm([
      verification.userId,
      verification.documentName,
      verification.status,
      memberById.get(verification.userId)?.displayName,
      memberById.get(verification.userId)?.email,
    ], normalizedSearch));
  const filteredCategories = categories.filter((category) =>
    (statusFilter === "all" || category.status === statusFilter)
    && includesTerm([category.name, category.description], normalizedSearch));
  const filteredActivity = activity.filter((entry) =>
    (dateFilter === "all" || timeOf(entry) >= nowMilliseconds - Number(dateFilter) * 24 * 60 * 60 * 1000)
    && includesTerm([entry.actorName, entry.actorId, entry.action, entry.entityType,
      entry.entityId, entry.summary], normalizedSearch));
  const sortedUsers = [...filteredUsers].sort((a, b) => userSort === "name"
    ? (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "")
    : userSort === "oldest" ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a));
  const buckets = useMemo(() => {
    const result = makeBuckets(interval, new Date());
    const byKey = new Map(result.map((bucket) => [bucket.key, bucket]));
    for (const member of users) {
      const milliseconds = timeOf(member);
      const bucket = byKey.get(dateBucketKey(milliseconds, interval));
      if (milliseconds && bucket) bucket.users += 1;
    }
    for (const listing of listings) {
      const milliseconds = timeOf(listing);
      const bucket = byKey.get(dateBucketKey(milliseconds, interval));
      if (milliseconds && bucket) bucket.listings += 1;
    }
    for (const swap of swaps) {
      const milliseconds = timeOf(swap);
      const bucket = byKey.get(dateBucketKey(milliseconds, interval));
      if (milliseconds && bucket) bucket.swaps += 1;
    }
    return result;
  }, [interval, listings, swaps, users]);

  const topCategories = [...listings.reduce((counts, listing) => {
    if ((listing.status ?? "active") !== "active") return counts;
    const name = listing.category?.trim() || "Uncategorized";
    counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const popularSkills = [...swaps.reduce((counts, swap) => {
    const skill = listingById.get(swap.skillId);
    const title = skill?.title || "Unavailable listing";
    counts.set(title, (counts.get(title) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const activeMembers = [...swaps.reduce((counts, swap) => {
    counts.set(swap.fromUserId, (counts.get(swap.fromUserId) ?? 0) + 1);
    counts.set(swap.toUserId, (counts.get(swap.toUserId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxActivity = Math.max(1, ...buckets.flatMap((bucket) => [bucket.users, bucket.listings, bucket.swaps]));
  const maxCategory = Math.max(1, ...topCategories.map(([, count]) => count));
  const pageSize = 20;
  const sortedCategories = [...filteredCategories].sort((first, second) =>
    (categorySort === "newest" ? -1 : 1) * (timeOf(first) - timeOf(second)));
  const pendingCategoryRequests = categoryRequests
    .filter((request) => request.status === "pending")
    .sort((first, second) =>
      (categoryRequestSort === "newest" ? -1 : 1) * (timeOf(first) - timeOf(second)));
  const currentCategoryPage = Math.min(categoryPage, Math.max(0,
    Math.ceil(sortedCategories.length / pageSize) - 1));
  const currentCategoryRequestPage = Math.min(categoryRequestPage, Math.max(0,
    Math.ceil(pendingCategoryRequests.length / pageSize) - 1));
  const visibleCategories = sortedCategories.slice(
    currentCategoryPage * pageSize,
    (currentCategoryPage + 1) * pageSize,
  );
  const visibleCategoryRequests = pendingCategoryRequests.slice(
    currentCategoryRequestPage * pageSize,
    (currentCategoryRequestPage + 1) * pageSize,
  );
  const currentNotificationPage = Math.min(page, Math.max(0,
    Math.ceil(notifications.length / pageSize) - 1));
  const visibleNotifications = notifications.slice(
    currentNotificationPage * pageSize,
    (currentNotificationPage + 1) * pageSize,
  );

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  async function updateUserStatus(member: AdminUser, status: AccountStatus) {
    if (!user || member.id === user.uid || member.role === "admin") return;
    if (!window.confirm(`${status === "suspended" ? "Suspend" : "Restore"} ${member.displayName || member.email || "this account"}?`)) return;
    setSavingId(member.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "users", member.id), { status, updatedAt: serverTimestamp() });
      addActivity(batch, user, status === "suspended" ? "suspend_user" : "restore_user",
        "user", member.id, `${status === "suspended" ? "Suspended" : "Restored"} ${member.email || member.id}.`,
        { status: member.status ?? "active" }, { status });
      await batch.commit();
      setUsers((current) => current.map((item) => item.id === member.id ? { ...item, status } : item));
      setNotice(status === "suspended" ? "Account suspended." : "Account restored.");
      await loadData();
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function updateUserRole(member: AdminUser, role: "user" | "admin") {
    if (!user || member.id === user.uid || member.role === role) return;
    const verb = role === "admin" ? "Promote" : "Remove administrator access from";
    if (!window.confirm(`${verb} ${member.displayName || member.email || "this account"}? This changes access to all admin tools.`)) return;
    setSavingId(member.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "users", member.id), { role, updatedAt: serverTimestamp() });
      addActivity(batch, user, role === "admin" ? "promote_admin" : "remove_admin",
        "user", member.id, `${verb} ${member.email || member.id}.`,
        { role: member.role ?? "user" }, { role });
      await batch.commit();
      await loadData();
      setNotice("User role updated.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function updateListingStatus(listing: AdminListing, status: ListingStatus) {
    if (!user) return;
    const title = listing.title || "this listing";
    if (!window.confirm(`${status === "removed" ? "Remove" : status === "paused" ? "Pause" : "Restore"} “${title}”?`)) return;
    setSavingId(listing.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "skills", listing.id), { status, updatedAt: serverTimestamp() });
      addActivity(batch, user, `listing_${status}`, "skill", listing.id,
        `${status === "removed" ? "Removed" : status === "paused" ? "Paused" : "Restored"} “${title}”.`,
        { status: listing.status ?? "active" }, { status });
      await batch.commit();
      await loadData();
      setNotice(`Listing ${status}.`);
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function cancelSwap(swap: AdminSwap) {
    if (!user || swap.status !== "pending") return;
    if (!window.confirm("Cancel this pending swap request? The participants will retain the request history.")) return;
    setSavingId(swap.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "swapRequests", swap.id), { status: "cancelled", updatedAt: serverTimestamp() });
      addActivity(batch, user, "cancel_swap", "swapRequest", swap.id,
        `Cancelled pending swap ${swap.id}.`, { status: swap.status }, { status: "cancelled" });
      await batch.commit();
      await loadData();
      setNotice("Swap request cancelled.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const name = categoryName.trim();
    const description = categoryDescription.trim();
    const id = editingCategory?.id ?? categoryKey(name);
    if (name.length < 2 || name.length > 40 || !id) {
      setError("Category names must contain 2–40 characters.");
      return;
    }
    if (categories.some((item) => item.id !== editingCategory?.id && item.name.toLowerCase() === name.toLowerCase())) {
      setError("A category with this name already exists.");
      return;
    }
    if (!editingCategory && defaultCategories.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setError("That name is already reserved by a built-in member category.");
      return;
    }
    if (editingCategory && editingCategory.name.toLowerCase() !== name.toLowerCase()
      && categoryRequests.some((request) => request.status === "approved" && request.name.toLowerCase() === editingCategory.name.toLowerCase())) {
      setError("This category came from an approved member request. Deactivate it and create a new category instead of changing its request history.");
      return;
    }
    const existing = editingCategory;
    const affectedListings = existing && existing.name !== name
      ? listings.filter((listing) => listing.category?.toLowerCase() === existing.name.toLowerCase()) : [];
    if (affectedListings.length > 498) {
      setError("This category is used by too many listings to rename in one safe batch. Reduce its usage before renaming.");
      return;
    }
    if (!existing && categories.some((item) => item.id === id)) {
      setError("This category key already exists. Use a different name.");
      return;
    }
    setSavingId("category-form");
    clearMessages();
    try {
      const batch = writeBatch(db);
      const next: Pick<AdminCategory, "name" | "description" | "status"> = {
        name, description, status: existing?.status ?? "active",
      };
      if (existing) {
        batch.update(doc(db, "categories", existing.id), { ...next, updatedAt: serverTimestamp() });
        for (const listing of affectedListings) {
          batch.update(doc(db, "skills", listing.id), { category: name, updatedAt: serverTimestamp() });
        }
      } else {
        batch.set(doc(db, "categories", id), {
          ...next, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
      addActivity(batch, user, existing ? "edit_category" : "create_category", "category", id,
        `${existing ? "Updated" : "Added"} category “${name}”.`,
        existing ? { name: existing.name, description: existing.description } : null,
        { name, description });
      await batch.commit();
      setCategoryName("");
      setCategoryDescription("");
      setEditingCategory(null);
      await loadData();
      setNotice(existing ? "Category updated." : "Category added.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function deleteCategory(category: AdminCategory) {
    if (!user) return;
    const usage = listings.filter((listing) => listing.category?.toLowerCase() === category.name.toLowerCase()).length;
    if (usage > 0) {
      setError(`Cannot remove “${category.name}”: ${usage} listing${usage === 1 ? "" : "s"} still use it.`);
      return;
    }
    if (defaultCategories.some((name) => name.toLowerCase() === category.name.toLowerCase())
      || categoryRequests.some((request) => request.status === "approved" && request.name.toLowerCase() === category.name.toLowerCase())) {
      setError("This category is part of the built-in or approved-request catalog. Deactivate it instead to preserve its history.");
      return;
    }
    if (!window.confirm(`Permanently remove category “${category.name}”? This cannot be undone.`)) return;
    setSavingId(category.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "categories", category.id));
      addActivity(batch, user, "delete_category", "category", category.id,
        `Removed category “${category.name}”.`, { name: category.name }, null);
      await batch.commit();
      await loadData();
      setNotice("Category removed.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function setCategoryStatus(category: AdminCategory, status: AdminCategory["status"]) {
    if (!user || category.status === status) return;
    setSavingId(category.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "categories", category.id), { status, updatedAt: serverTimestamp() });
      addActivity(batch, user, status === "active" ? "activate_category" : "deactivate_category",
        "category", category.id, `${status === "active" ? "Activated" : "Deactivated"} category “${category.name}”.`,
        { status: category.status }, { status });
      await batch.commit();
      await loadData();
      setNotice(status === "active" ? "Category activated." : "Category deactivated and hidden from member category filters.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function importLegacyCategories() {
    if (!user || !legacyCategories.length) return;
    const categoryIds = new Set(categories.map((category) => category.id));
    const imports = new Map<string, AdminCategoryRequest>();
    for (const request of legacyCategories) {
      const id = categoryKey(request.name);
      if (!id || categoryIds.has(id) || imports.has(id)) {
        setError(`Could not safely import approved category “${request.name}” because its normalized ID is invalid or already in use.`);
        return;
      }
      imports.set(id, request);
    }
    if (!window.confirm(`Import ${imports.size} previously approved category request${imports.size === 1 ? "" : "s"} into the category catalog? Existing request history will be preserved.`)) return;
    setSavingId("legacy-categories");
    clearMessages();
    try {
      const entries = [...imports.entries()];
      for (let offset = 0; offset < entries.length; offset += 160) {
        const batch = writeBatch(db);
        entries.slice(offset, offset + 160).forEach(([id, request]) => {
          batch.set(doc(db, "categories", id), {
            name: request.name.trim(), description: "", status: "active",
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          addActivity(batch, user, "import_legacy_category", "category", id,
            `Imported previously approved category “${request.name.trim()}”.`,
            null, { name: request.name.trim(), status: "active" });
        });
        await batch.commit();
      }
      await loadData();
      setNotice(`Imported ${imports.size} approved category${imports.size === 1 ? "" : "ies"}.`);
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function setCategoryRequestStatus(request: AdminCategoryRequest, status: "approved" | "declined") {
    if (!user) return;
    const key = categoryKey(request.name);
    if (status === "approved" && !key) {
      setError("The requested category name cannot be used as a category ID.");
      return;
    }
    if (status === "approved" && (categories.some((item) => item.name.toLowerCase() === request.name.toLowerCase() || item.id === key)
      || defaultCategories.some((item) => item.toLowerCase() === request.name.toLowerCase()))) {
      setError("This category already exists or its category ID is already in use. Decline the duplicate request instead.");
      return;
    }
    setSavingId(request.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "categoryRequests", request.id), { status, updatedAt: serverTimestamp() });
      if (status === "approved") {
        batch.set(doc(db, "categories", key), {
          name: request.name.trim(), description: "", status: "active",
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
      addActivity(batch, user, `category_request_${status}`, "categoryRequest", request.id,
        `${status === "approved" ? "Approved" : "Declined"} category request “${request.name}”.`,
        { status: "pending" }, { status });
      await batch.commit();
      await loadData();
      setNotice(status === "approved" ? "Category request approved and added to the catalog." : "Category request declined.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function updateReport(report: AdminReport, status: ReportStatus) {
    if (!user) return;
    setSavingId(report.id);
    clearMessages();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "reports", report.id), {
        status,
        resolutionNote: (reportNotes[report.id] ?? "").trim(),
        moderatorId: user.uid,
        moderatorName: user.displayName || user.email || "Administrator",
        updatedAt: serverTimestamp(),
      });
      addActivity(batch, user, `report_${status}`, "report", report.id,
        `Marked report ${report.id} as ${status.replace("_", " ")}.`,
        { status: report.status }, { status });
      await batch.commit();
      await loadData();
      setNotice("Report status and moderation decision saved.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function reviewVerification(verification: AdminVerification, status: "approved" | "rejected") {
    if (!user || verification.status !== "pending") return;
    setSavingId(verification.id);
    clearMessages();
    let cleanupWarning = "";
    try {
      const note = (verificationNotes[verification.id] ?? "").trim();
      const batch = writeBatch(db);
      batch.update(doc(db, "idVerifications", verification.id), {
        status,
        reviewNote: note,
        reviewerId: user.uid,
        reviewerName: user.displayName || user.email || "Administrator",
        reviewedAt: serverTimestamp(),
        storageDeleted: false,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, "users", verification.userId), {
        verified: status === "approved",
        updatedAt: serverTimestamp(),
      });
      addActivity(batch, user, `identity_verification_${status}`, "idVerification", verification.id,
        `${status === "approved" ? "Approved" : "Rejected"} identity verification for ${memberById.get(verification.userId)?.displayName || verification.userId}.`,
        { status: "pending" }, { status, reviewNote: note });
      await batch.commit();

      try {
        await deleteObject(storageRef(storage, verification.storagePath));
        const batch = writeBatch(db);
        batch.update(doc(db, "idVerifications", verification.id), {
          storageDeleted: true,
          updatedAt: serverTimestamp(),
        });
        addActivity(batch, user, "identity_evidence_deleted", "idVerification", verification.id,
          `Deleted stored identity evidence for ${memberById.get(verification.userId)?.displayName || verification.userId}.`,
          { storageDeleted: false }, { storageDeleted: true });
        await batch.commit();
      } catch (cleanupError) {
        console.error("Identity evidence was reviewed but could not be removed from Storage.", cleanupError);
        cleanupWarning = " The identity document could not be deleted automatically; retry deletion from this review record.";
      }

      await loadData();
      setNotice(`Identity verification ${status}.${cleanupWarning}`);
    } catch (reviewError) {
      setError(getAuthErrorMessage(reviewError));
    } finally {
      setSavingId(null);
    }
  }

  async function removeVerificationEvidence(verification: AdminVerification) {
    if (!verification.storagePath || verification.storageDeleted) return;
    setSavingId(verification.id);
    clearMessages();
    try {
      try {
        await deleteObject(storageRef(storage, verification.storagePath));
      } catch (storageError) {
        if (!(typeof storageError === "object" && storageError !== null
          && "code" in storageError && storageError.code === "storage/object-not-found")) {
          throw storageError;
        }
      }
      const batch = writeBatch(db);
      batch.update(doc(db, "idVerifications", verification.id), {
        storageDeleted: true,
        updatedAt: serverTimestamp(),
      });
      if (!user) throw new Error("Administrator session is unavailable.");
      addActivity(batch, user, "identity_evidence_deleted", "idVerification", verification.id,
        `Deleted stored identity evidence for ${memberById.get(verification.userId)?.displayName || verification.userId}.`,
        { storageDeleted: false }, { storageDeleted: true });
      await batch.commit();
      await loadData();
      setNotice("Identity evidence permanently deleted from Firebase Storage.");
    } catch (deleteError) {
      setError(getAuthErrorMessage(deleteError));
    } finally {
      setSavingId(null);
    }
  }

  async function downloadVerificationEvidence(verification: AdminVerification) {
    setSavingId(verification.id);
    clearMessages();
    try {
      const blob = await getBlob(storageRef(storage, verification.storagePath), 10 * 1024 * 1024);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const extension = verification.contentType === "application/pdf"
        ? "pdf"
        : verification.contentType === "image/png" ? "png" : "jpg";
      anchor.download = `identity-document-${verification.userId}.${extension}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (downloadError) {
      setError(getAuthErrorMessage(downloadError));
    } finally {
      setSavingId(null);
    }
  }

  async function markNotificationRead(notification: AdminNotification) {
    if (notification.read) return;
    setSavingId(notification.id);
    clearMessages();
    try {
      await updateDoc(doc(db, "notifications", notification.id), { read: true });
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  async function markAllNotificationsRead() {
    const unread = notifications.filter((notification) => !notification.read);
    if (!user || !unread.length) return;
    setSavingId("notifications");
    clearMessages();
    try {
      for (let offset = 0; offset < unread.length; offset += 450) {
        const batch = writeBatch(db);
        unread.slice(offset, offset + 450).forEach((notification) => {
          batch.update(doc(db, "notifications", notification.id), { read: true });
        });
        await batch.commit();
      }
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      setNotice("All notifications marked as read.");
    } catch (actionError) { setError(getAuthErrorMessage(actionError)); }
    finally { setSavingId(null); }
  }

  function exportAnalytics() {
    const rows = [
      ["period", "new_users", "new_listings", "swap_requests"],
      ...buckets.map((bucket) => [bucket.label, String(bucket.users), String(bucket.listings), String(bucket.swaps)]),
    ];
    const csv = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `skill-swap-analytics-${interval}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleThemeToggle() {
    try { await toggleTheme(); }
    catch (themeError) { setError(getAuthErrorMessage(themeError)); }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(); router.replace("/"); }
    catch (signOutError) { setError(getAuthErrorMessage(signOutError)); setSigningOut(false); }
  }

  function setSectionAndSearch(next: Section) {
    setSection(next);
    setSearch("");
    setPage(0);
    setStatusFilter("all");
    setDateFilter("all");
    setCategoryFilter("all");
  }

  function getMemberSwapCount(id: string) {
    return swaps.filter((swap) => swap.fromUserId === id || swap.toUserId === id).length;
  }

  function getMemberListingCount(id: string) {
    return listings.filter((listing) => listing.ownerId === id).length;
  }

  function renderPagination(
    total: number,
    currentPage = page,
    onPageChange: (nextPage: number) => void = setPage,
  ) {
    const pages = Math.ceil(total / pageSize);
    if (pages <= 1) return null;
    const safePage = Math.min(currentPage, pages - 1);
    return <div className="admin-pagination">
      <span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, total)} of {total}</span>
      <div>
        <button type="button" className="admin-button secondary" disabled={safePage === 0} onClick={() => onPageChange(Math.max(0, safePage - 1))}>Previous</button>
        <button type="button" className="admin-button secondary" disabled={safePage >= pages - 1} onClick={() => onPageChange(Math.min(pages - 1, safePage + 1))}>Next</button>
      </div>
    </div>;
  }

  if (loading || !user || checkingAccess) {
    return <main className="dashboard-loading" role="status"><span className="loading-indicator" /><span>Verifying administrator access</span></main>;
  }

  if (!authorized) {
    return <main className="dashboard-loading">
      <div role={error ? "alert" : "status"}>{error ?? "Returning to the member dashboard."}</div>
      <Link className="back-link" href="/dashboard">Back to dashboard</Link>
    </main>;
  }

  const chartData = buckets;
  return <main className="dashboard-shell admin-shell" data-theme={theme}>
    <aside className="admin-sidebar">
      <Link className="admin-brand" href="/dashboard"><span className="dashboard-brand-mark" aria-hidden="true">s</span><span>skill swap</span></Link>
      <p className="admin-sidebar-label">WORKSPACE</p>
      <nav className="admin-sidebar-nav" aria-label="Admin navigation">
        {navigation.map((item) => <button key={item.id} type="button"
          className={section === item.id ? "admin-side-link selected" : "admin-side-link"}
          aria-current={section === item.id ? "page" : undefined}
          onClick={() => setSectionAndSearch(item.id)}>
          <span className="admin-side-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
          {item.id === "reports" && pendingReports > 0 && <span className="admin-nav-count">{pendingReports}</span>}
          {item.id === "verification" && pendingVerifications > 0 && <span className="admin-nav-count">{pendingVerifications}</span>}
        </button>)}
      </nav>
      <Link className="admin-sidebar-back" href="/dashboard">← Member dashboard</Link>
    </aside>

    <section className="admin-content">
      <header className="admin-topbar">
        <div className="admin-mobile-brand"><span className="dashboard-brand-mark" aria-hidden="true">s</span><span>skill swap</span></div>
        <label className="admin-global-search">
          <span aria-hidden="true">⌕</span>
          <span className="visually-hidden">Search current section</span>
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); if (section === "overview" && event.target.value.trim()) setSection("users"); }} placeholder={`Search ${section === "overview" ? "platform" : navigation.find((item) => item.id === section)?.label.toLowerCase()}`} />
        </label>
        <div className="admin-top-actions">
          <button type="button" className="admin-icon-button" onClick={() => setSectionAndSearch("notifications")} aria-label={`Notifications, ${notifications.filter((item) => !item.read).length} unread`}>
            ♧{notifications.some((item) => !item.read) && <span className="admin-unread-dot" />}
          </button>
          <button type="button" className="admin-icon-button" onClick={() => void handleThemeToggle()} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
            {theme === "light" ? "◐" : "☀"}
          </button>
          <div className="admin-profile-control">
            <button type="button" className="admin-account" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>
              <span className="admin-avatar">{(user.displayName || user.email || "A").slice(0, 1).toUpperCase()}</span>
              <span><strong>{user.displayName || "Administrator"}</strong><small>{user.email}</small></span>
            </button>
            {profileMenuOpen && <div className="admin-profile-menu"><strong>{user.displayName || "Administrator"}</strong><small>{user.email}</small><button type="button" disabled={signingOut} onClick={() => void handleSignOut()}>{signingOut ? "Signing out…" : "Sign out"}</button></div>}
          </div>
        </div>
      </header>

      <div className="admin-page">
        <div className="admin-page-heading">
          <div>
            <p className="dashboard-eyebrow">COMMUNITY OPERATIONS</p>
            <h1>{navigation.find((item) => item.id === section)?.label}</h1>
            <p className="admin-page-subtitle">
              {section === "overview" ? "Monitor your community and take action where it matters." :
                section === "settings" ? "Review platform controls and trusted administrator access." :
                  "Review real platform records and manage community operations."}
            </p>
          </div>
          <div className="admin-heading-actions">
            <span className="admin-live-indicator"><i /> Firestore data</span>
            <button type="button" className="admin-button secondary" onClick={() => void loadData()} disabled={loadingData}>↻ Refresh</button>
          </div>
        </div>

        {error && <p className="dashboard-message dashboard-error" role="alert">{error}</p>}
        {notice && <p className="dashboard-message dashboard-notice" role="status">{notice}</p>}

        {loadingData ? <div className="admin-skeleton-grid" aria-label="Loading dashboard data" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="admin-skeleton-card" />)}
        </div> : null}

        {!loadingData && section === "overview" && <>
          <div className="admin-kpi-grid">
            <article className="admin-kpi-card"><span>Total registered users</span><strong>{users.length.toLocaleString()}</strong><small>{activeUsers} active · {suspendedUsers} suspended</small></article>
            <article className="admin-kpi-card"><span>Skill listings</span><strong>{listings.length.toLocaleString()}</strong><small>{activeListings} currently active</small></article>
            <article className="admin-kpi-card"><span>Swap requests</span><strong>{swaps.length.toLocaleString()}</strong><small>{pendingSwaps} awaiting a response</small></article>
            <article className="admin-kpi-card"><span>Completed exchanges</span><strong>{completedSwaps.toLocaleString()}</strong><small>{cancelledSwaps} declined or cancelled</small></article>
          </div>
          <div className="admin-kpi-grid admin-kpi-grid-secondary">
            <article className="admin-kpi-card compact"><span>New members this week</span><strong>{users.filter((member) => timeOf(member) >= startOfWeek).length}</strong></article>
            <article className="admin-kpi-card compact"><span>New members this month</span><strong>{users.filter((member) => timeOf(member) >= startOfMonth).length}</strong></article>
            <article className="admin-kpi-card compact"><span>Pending category requests</span><strong>{categoryRequests.filter((item) => item.status === "pending").length}</strong></article>
            <article className="admin-kpi-card compact"><span>Open reports</span><strong>{pendingReports}</strong></article>
            <article className="admin-kpi-card compact"><span>Pending ID verification</span><strong>{pendingVerifications}</strong><small>Private documents awaiting review</small></article>
          </div>
          <div className="admin-panel-grid">
            <section className="admin-panel admin-chart-panel">
              <div className="admin-panel-heading"><div><h2>Platform growth</h2><p>New members, listings, and swap requests</p></div>
                <select aria-label="Chart interval" value={interval} onChange={(event) => setInterval(event.target.value as Interval)}>
                  <option value="daily">Daily · 30 days</option><option value="weekly">Weekly · 12 weeks</option>
                  <option value="monthly">Monthly · 12 months</option><option value="yearly">Yearly · 5 years</option>
                </select>
              </div>
              <div className="admin-chart-legend"><span><i className="members" /> Users</span><span><i className="listings" /> Listings</span><span><i className="swaps" /> Swap requests</span></div>
              {chartData.some((bucket) => bucket.users + bucket.listings + bucket.swaps > 0) ? <div className={`admin-bar-chart ${interval}`} role="img" aria-label={`New user, listing, and swap counts by ${interval}`}>
                {chartData.map((bucket) => <div className="admin-chart-column" key={bucket.key}>
                  <div className="admin-chart-bars">
                    <i className="members" title={`${bucket.users} new users`} style={{ height: `${bucket.users ? Math.max(5, bucket.users / maxActivity * 100) : 0}%` }} />
                    <i className="listings" title={`${bucket.listings} listings`} style={{ height: `${bucket.listings ? Math.max(5, bucket.listings / maxActivity * 100) : 0}%` }} />
                    <i className="swaps" title={`${bucket.swaps} swap requests`} style={{ height: `${bucket.swaps ? Math.max(5, bucket.swaps / maxActivity * 100) : 0}%` }} />
                  </div><span>{bucket.label}</span>
                </div>)}
              </div> : <div className="admin-empty">No activity for the selected period yet.</div>}
            </section>
            <section className="admin-panel">
              <div className="admin-panel-heading"><div><h2>Popular categories</h2><p>By active listing count</p></div><button className="admin-text-button" type="button" onClick={() => setSectionAndSearch("categories")}>Manage</button></div>
              {topCategories.length ? <div className="admin-progress-list">{topCategories.map(([name, count]) => <div key={name}>
                <div><span>{name}</span><strong>{count}</strong></div><i><span style={{ width: `${count / maxCategory * 100}%` }} /></i>
              </div>)}</div> : <div className="admin-empty">No active listings to analyze.</div>}
            </section>
          </div>
          <div className="admin-panel-grid">
            <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Most requested skills</h2><p>Based on swap requests tied to current listings</p></div></div>
              {popularSkills.length ? <div className="admin-compact-list">{popularSkills.map(([name, count]) => <div key={name}><span>{name}</span><strong>{count} requests</strong></div>)}</div> : <div className="admin-empty">No swap requests yet.</div>}
            </section>
            <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Most active members</h2><p>Swap participation count</p></div></div>
              {activeMembers.length ? <div className="admin-compact-list">{activeMembers.map(([id, count]) => {
                const member = memberById.get(id);
                return <div key={id}><span>{member?.displayName || member?.email || id}</span><strong>{count} swaps</strong></div>;
              })}</div> : <div className="admin-empty">Member activity will appear as swaps are created.</div>}
            </section>
          </div>
        </>}

        {!loadingData && section === "users" && <section className="admin-panel admin-table-panel">
          <div className="admin-panel-heading"><div><h2>Members</h2><p>Search by name, email, UID, or role. Accounts are never deleted here.</p></div>
            <div className="admin-row-actions"><select aria-label="Filter users by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
              <select aria-label="Filter users by registration date" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setPage(0); }}><option value="all">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
              <select aria-label="Sort users" value={userSort} onChange={(event) => setUserSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option></select>
            </div>
          </div>
          {sortedUsers.length ? <div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Member</th><th>Status</th><th>Registered</th><th>Listings</th><th>Swap history</th><th>Account action</th></tr></thead>
            <tbody>{sortedUsers.slice(page * pageSize, (page + 1) * pageSize).map((member) => {
              const isProtected = member.id === user.uid || member.role === "admin";
              const status = member.status === "suspended" ? "suspended" : "active";
              const memberListings = listings.filter((listing) => listing.ownerId === member.id);
              const memberSwaps = swaps.filter((swap) => swap.fromUserId === member.id || swap.toUserId === member.id);
              return <tr key={member.id}><td><div className="admin-member-cell"><span className="admin-avatar small">{(member.displayName || member.email || "U").slice(0, 1).toUpperCase()}</span><span><Link className="admin-member-profile-link" href={`/profile/${encodeURIComponent(member.id)}`}>{member.displayName || "Unnamed member"}</Link><small>{member.email || "No email"}</small><small><code>{member.id}</code></small>
                <details className="admin-user-details"><summary>View skills & swaps</summary><ul>
                  {memberListings.map((listing) => <li key={listing.id}>Skill: {listing.title || "Untitled"} · {listing.status ?? "active"}</li>)}
                  {memberSwaps.map((swap) => <li key={swap.id}>Swap: {listingById.get(swap.skillId)?.title || "Skill listing"} · {swap.status} · {formatDate(swap.createdAt)}</li>)}
                  {!memberListings.length && !memberSwaps.length && <li>No listings or swap history.</li>}
                </ul></details></span></div></td>
                <td><span className={`admin-status-pill ${status}`}>{status}</span>{member.role === "admin" && <span className="admin-role-tag">admin</span>}</td>
                <td>{formatDate(member.createdAt)}</td><td>{getMemberListingCount(member.id)}</td><td>{getMemberSwapCount(member.id)}</td>
                <td><div className="admin-row-actions">{isProtected ? <span className="admin-muted">{member.id === user.uid ? "Your account" : "Protected admin"}</span> : <>
                  <button type="button" className={`admin-button ${status === "suspended" ? "secondary" : "danger"}`} disabled={savingId === member.id} onClick={() => void updateUserStatus(member, status === "suspended" ? "active" : "suspended")}>{status === "suspended" ? "Restore" : "Suspend"}</button>
                  <select aria-label={`Change role for ${member.displayName || member.email || member.id}`} value={member.role === "admin" ? "admin" : "user"} disabled={savingId === member.id} onChange={(event) => void updateUserRole(member, event.target.value as "user" | "admin")}><option value="user">Member</option><option value="admin">Admin</option></select>
                </>}</div></td>
              </tr>;
            })}</tbody>
          </table></div> : <div className="admin-empty">No members match this search or filter.</div>}
          {renderPagination(sortedUsers.length)}
        </section>}

        {!loadingData && section === "listings" && <section className="admin-panel admin-table-panel">
          <div className="admin-panel-heading"><div><h2>Skill listings</h2><p>Review and moderate existing community listings.</p></div>
            <div className="admin-row-actions"><select aria-label="Filter listings by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="removed">Removed</option></select>
              <select aria-label="Filter listings by category" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(0); }}><option value="all">All categories</option>{[...new Set(listings.map((item) => item.category).filter((value): value is string => Boolean(value)))].sort().map((category) => <option key={category}>{category}</option>)}</select>
            </div>
          </div>
          {filteredListings.length ? <div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Listing</th><th>Owner</th><th>Category</th><th>Session</th><th>Price</th><th>Submitted</th><th>Status</th><th>Moderation</th></tr></thead>
            <tbody>{filteredListings.slice(page * pageSize, (page + 1) * pageSize).map((listing) => {
              const status = listing.status ?? "active";
              return <tr key={listing.id}><td className="admin-listing-cell"><strong>{listing.title || "Untitled listing"}</strong><small>{listing.description || "No description"}</small></td>
                <td>{listing.ownerName || memberById.get(listing.ownerId)?.displayName || listing.ownerId}</td><td>{listing.category || "Uncategorized"}</td><td>{listing.durationMinutes ?? DEFAULT_SKILL_DURATION_MINUTES} min</td><td>{formatSkillPrice(listing.price)}</td><td>{formatDate(listing.createdAt)}</td>
                <td><span className={`admin-status-pill ${status}`}>{status}</span></td><td><div className="admin-row-actions">
                  {status === "removed" ? <button type="button" className="admin-button secondary" disabled={savingId === listing.id} onClick={() => void updateListingStatus(listing, "active")}>Restore</button> : <>
                    <button type="button" className="admin-button secondary" disabled={savingId === listing.id} onClick={() => void updateListingStatus(listing, status === "paused" ? "active" : "paused")}>{status === "paused" ? "Activate" : "Pause"}</button>
                    <button type="button" className="admin-button danger" disabled={savingId === listing.id} onClick={() => void updateListingStatus(listing, "removed")}>Remove</button>
                  </>}
                </div></td></tr>;
            })}</tbody>
          </table></div> : <div className="admin-empty">No listings match this search or filter.</div>}
          {renderPagination(filteredListings.length)}
        </section>}

        {!loadingData && section === "swaps" && <section className="admin-panel admin-table-panel">
          <div className="admin-panel-heading"><div><h2>Swap requests</h2><p>Cashless exchange activity. Only pending requests can be cancelled by an administrator.</p></div>
            <div className="admin-row-actions"><select aria-label="Filter swaps by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}><option value="all">All statuses</option>{(["pending", "accepted", "completed", "declined", "cancelled"] as SwapStatus[]).map((value) => <option key={value} value={value}>{value}</option>)}</select>
              <select aria-label="Filter swap requests by date" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setPage(0); }}><option value="all">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
            </div>
          </div>
          {filteredSwaps.length ? <div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Requested skill</th><th>Requester</th><th>Recipient</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{filteredSwaps.slice(page * pageSize, (page + 1) * pageSize).map((swap) => <tr key={swap.id}>
              <td><strong>{listingById.get(swap.skillId)?.title || "Listing unavailable"}</strong><small className="admin-cell-subtitle">{swap.id}</small></td>
              <td>{memberById.get(swap.fromUserId)?.displayName || swap.fromUserId}</td><td>{memberById.get(swap.toUserId)?.displayName || swap.toUserId}</td>
              <td>{formatDate(swap.createdAt)}</td><td><span className={`admin-status-pill ${swap.status}`}>{swap.status}</span></td>
              <td>{swap.status === "pending" ? <button type="button" className="admin-button danger" disabled={savingId === swap.id} onClick={() => void cancelSwap(swap)}>Cancel request</button> : <span className="admin-muted">Participant managed</span>}</td>
            </tr>)}</tbody>
          </table></div> : <div className="admin-empty">No swap requests match this search or filter.</div>}
          {renderPagination(filteredSwaps.length)}
        </section>}

        {!loadingData && section === "exchanges" && <section className="admin-panel admin-table-panel">
          <div className="admin-panel-heading"><div><h2>Exchange activity</h2><p>No cash or monetary transaction data is collected. Accepted and completed skill exchanges appear here.</p></div>
            <select aria-label="Filter exchanges by date" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setPage(0); }}><option value="all">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
          </div>
          {filteredExchanges.length ? <div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Skill exchanged</th><th>Participants</th><th>Exchange started</th><th>Status</th></tr></thead>
            <tbody>{filteredExchanges.slice(page * pageSize, (page + 1) * pageSize).map((swap) => <tr key={swap.id}>
              <td><strong>{listingById.get(swap.skillId)?.title || "Listing unavailable"}</strong><small className="admin-cell-subtitle">{swap.id}</small></td>
              <td>{memberById.get(swap.fromUserId)?.displayName || swap.fromUserId} ↔ {memberById.get(swap.toUserId)?.displayName || swap.toUserId}</td>
              <td>{formatDate(swap.createdAt)}</td><td><span className={`admin-status-pill ${swap.status}`}>{swap.status}</span></td>
            </tr>)}</tbody>
          </table></div> : <div className="admin-empty">No accepted or completed exchanges match this period.</div>}
          {renderPagination(filteredExchanges.length)}
        </section>}

        {!loadingData && section === "categories" && <div className="admin-panel-grid category-admin-layout">
          <section className="admin-panel">
            <div className="admin-panel-heading"><div><h2>{editingCategory ? "Edit category" : "Add a category"}</h2><p>Additional categories are available to members alongside the built-in categories.</p></div>
              {legacyCategories.length > 0 && <button type="button" className="admin-button secondary" disabled={savingId === "legacy-categories"} onClick={() => void importLegacyCategories()}>{savingId === "legacy-categories" ? "Importing…" : `Import ${legacyCategories.length} legacy`}</button>}
            </div>
            <form className="admin-form" onSubmit={(event) => void saveCategory(event)}>
              <label>Category name<input required minLength={2} maxLength={40} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Photography" /></label>
              <label>Description <span>(optional)</span><textarea maxLength={300} rows={3} value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} placeholder="What kind of skills belong here?" /></label>
              <div className="admin-row-actions"><button type="submit" className="admin-button primary" disabled={savingId === "category-form"}>{savingId === "category-form" ? "Saving…" : editingCategory ? "Save changes" : "Add category"}</button>
                {editingCategory && <button type="button" className="admin-button secondary" onClick={() => { setEditingCategory(null); setCategoryName(""); setCategoryDescription(""); }}>Cancel</button>}</div>
            </form>
            <div className="admin-subsection"><div className="admin-panel-heading"><h3>Member category requests</h3><select aria-label="Sort category requests" value={categoryRequestSort} onChange={(event) => { setCategoryRequestSort(event.target.value as typeof categoryRequestSort); setCategoryRequestPage(0); }}><option value="newest">Latest first</option><option value="oldest">Oldest first</option></select></div>
              {pendingCategoryRequests.length ? visibleCategoryRequests.map((request) => <article className="admin-request-card" key={request.id}>
                <div><strong>{request.name}</strong><small>By {request.requesterName || request.requesterId}</small>{request.reason && <p>{request.reason}</p>}</div>
                <div className="admin-row-actions"><button className="admin-button danger" type="button" disabled={savingId === request.id} onClick={() => void setCategoryRequestStatus(request, "declined")}>Decline</button><button className="admin-button primary" type="button" disabled={savingId === request.id} onClick={() => void setCategoryRequestStatus(request, "approved")}>Approve</button></div>
              </article>) : <p className="admin-muted">No pending category requests.</p>}
              {renderPagination(pendingCategoryRequests.length, currentCategoryRequestPage, setCategoryRequestPage)}
            </div>
          </section>
          <section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Custom categories</h2><p>Listing counts include all listing statuses.</p></div>
            <div className="admin-row-actions"><select aria-label="Filter categories by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setCategoryPage(0); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select><select aria-label="Sort categories" value={categorySort} onChange={(event) => { setCategorySort(event.target.value as typeof categorySort); setCategoryPage(0); }}><option value="newest">Latest first</option><option value="oldest">Oldest first</option></select></div>
          </div>
          {sortedCategories.length ? <div className="admin-category-list">{visibleCategories.map((category) => {
            const count = listings.filter((listing) => listing.category?.toLowerCase() === category.name.toLowerCase()).length;
            return <article className="admin-category-item" key={category.id}><div><strong>{category.name}</strong><p>{category.description || "No description"}</p><small>{count} listings · {category.status}</small></div>
              <div className="admin-row-actions"><button type="button" className="admin-button secondary" onClick={() => { setEditingCategory(category); setCategoryName(category.name); setCategoryDescription(category.description ?? ""); }}>Edit</button>
                <button type="button" className="admin-button secondary" disabled={savingId === category.id} onClick={() => void setCategoryStatus(category, category.status === "active" ? "inactive" : "active")}>{category.status === "active" ? "Deactivate" : "Activate"}</button>
                <button type="button" className="admin-button danger" disabled={savingId === category.id} onClick={() => void deleteCategory(category)}>Remove</button></div></article>;
          })}</div> : <div className="admin-empty">No custom categories yet. Built-in categories are maintained in the member app.</div>}
          {renderPagination(sortedCategories.length, currentCategoryPage, setCategoryPage)}
        </section></div>}

        {!loadingData && section === "verification" && <section className="admin-panel verification-admin-panel">
          <div className="admin-panel-heading">
            <div><h2>Identity verification requests</h2><p>Private identity documents are visible only to authorized administrators and the submitting member. Evidence is deleted after review.</p></div>
            <div className="admin-row-actions">
              <select aria-label="Filter verification status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}>
                <option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          {filteredVerifications.length ? <div className="verification-admin-list">
            {filteredVerifications.slice(page * pageSize, (page + 1) * pageSize).map((verification) => {
              const member = memberById.get(verification.userId);
              return <article className="verification-admin-card" key={verification.id}>
                <div className="verification-admin-heading">
                  <div><strong>{member?.displayName || "Skill Swap member"}</strong><small>{member?.email || verification.userId}</small><small>{verification.documentName} · {(verification.sizeBytes / 1024 / 1024).toFixed(2)} MB · {verification.contentType}</small><small>Submitted {formatDateTime(verification.createdAt)}</small></div>
                  <span className={`admin-status-pill ${verification.status}`}>{verification.status}</span>
                </div>
                {verification.storageDeleted
                  ? <p className="admin-muted">The identity evidence file has been deleted.</p>
                  : <div className="admin-row-actions verification-evidence-actions">
                    <button className="admin-button secondary" type="button" disabled={savingId === verification.id} onClick={() => void downloadVerificationEvidence(verification)}>Download evidence securely</button>
                    {verification.status !== "pending" && <button className="admin-button danger" type="button" disabled={savingId === verification.id} onClick={() => void removeVerificationEvidence(verification)}>Delete evidence</button>}
                  </div>}
                {verification.status === "pending" ? <>
                  <label className="dashboard-field verification-review-note"><span>Decision note <small>Shared with the member · 500 characters max</small></span><textarea value={verificationNotes[verification.id] ?? ""} onChange={(event) => setVerificationNotes((current) => ({ ...current, [verification.id]: event.target.value }))} maxLength={500} rows={3} /></label>
                  <div className="admin-row-actions"><button className="admin-button danger" type="button" disabled={savingId === verification.id} onClick={() => void reviewVerification(verification, "rejected")}>Reject</button><button className="admin-button primary" type="button" disabled={savingId === verification.id} onClick={() => void reviewVerification(verification, "approved")}>{savingId === verification.id ? "Saving..." : "Approve & verify"}</button></div>
                </> : <p className="admin-muted">{verification.reviewNote || "No review note."}</p>}
              </article>;
            })}
          </div> : <div className="admin-empty">No identity verification requests match this filter.</div>}
          {renderPagination(filteredVerifications.length)}
        </section>}

        {!loadingData && section === "reports" && <section className="admin-panel admin-table-panel">
          <div className="admin-panel-heading"><div><h2>Reports & moderation</h2><p>Investigate member-submitted reports, record a decision, and track moderator history.</p></div>
            <select aria-label="Filter reports by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}><option value="all">All statuses</option>{REPORT_STATUSES.map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</select>
          </div>
          {filteredReports.length ? <div className="admin-report-list">{filteredReports.slice(page * pageSize, (page + 1) * pageSize).map((report) => <article className="admin-report-card" key={report.id}>
            <div className="admin-report-top"><div><span className="admin-status-pill">{report.targetType} report</span><span className={`admin-status-pill ${report.status}`}>{report.status.replace("_", " ")}</span></div><small>{formatDate(report.createdAt)}</small></div>
            <h3>{report.targetName || (report.targetType === "user"
              ? memberById.get(report.targetId)?.displayName || memberById.get(report.targetId)?.email
              : listingById.get(report.targetId)?.title) || `${report.targetType} · ${report.targetId}`}</h3>
            <p>{report.reason}</p>
            <div className="admin-report-meta"><span>Reported by {report.reporterName || report.reporterId}</span><Link href={report.targetType === "user" ? `/profile/${encodeURIComponent(report.targetId)}` : listingById.get(report.targetId) ? `/profile/${encodeURIComponent(listingById.get(report.targetId)!.ownerId)}` : "/dashboard"}>Open {report.targetType}</Link></div>
            <label className="admin-report-note">Moderator note<input maxLength={500} value={reportNotes[report.id] ?? report.resolutionNote ?? ""} onChange={(event) => setReportNotes((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Optional decision notes" /></label>
            <div className="admin-report-actions"><select aria-label={`Set report ${report.id} status`} value={reportDrafts[report.id] ?? report.status} onChange={(event) => setReportDrafts((current) => ({ ...current, [report.id]: event.target.value as ReportStatus }))}>{REPORT_STATUSES.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select>
              <button type="button" className="admin-button primary" disabled={savingId === report.id} onClick={() => void updateReport(report, reportDrafts[report.id] ?? report.status)}>{savingId === report.id ? "Saving…" : "Save decision"}</button>
              {report.targetType === "user" && <button type="button" className="admin-button danger" disabled={savingId === report.targetId || memberById.get(report.targetId)?.role === "admin" || memberById.get(report.targetId)?.status === "suspended"} onClick={() => {
                const member = memberById.get(report.targetId);
                if (member) void updateUserStatus(member, "suspended");
                else setError("Reported account was not found.");
              }}>Suspend account</button>}
              {report.targetType === "listing" && <button type="button" className="admin-button danger" disabled={savingId === report.targetId} onClick={() => {
                const listing = listingById.get(report.targetId);
                if (listing) void updateListingStatus(listing, "removed");
                else setError("Reported listing was not found.");
              }}>Remove listing</button>}
            </div>
          </article>)}</div> : <div className="admin-empty">No reports match this search or filter. Member reports will appear here when submitted.</div>}
          {renderPagination(filteredReports.length)}
        </section>}

        {!loadingData && section === "notifications" && <section className="admin-panel admin-table-panel">
          <div className="admin-panel-heading"><div><h2>Admin notifications</h2><p>Notifications delivered to your administrator account.</p></div><button type="button" className="admin-button secondary" disabled={savingId === "notifications" || !notifications.some((item) => !item.read)} onClick={() => void markAllNotificationsRead()}>Mark all read</button></div>
          {notifications.length ? <div className="admin-notification-list">{visibleNotifications.map((notification) => <article className={notification.read ? "admin-notification" : "admin-notification unread"} key={notification.id}>
            <span className="admin-notification-mark">{notification.read ? "○" : "●"}</span><div><strong>{notification.kind.replaceAll("_", " ")}</strong><p>Related record: {notification.requestId} · From {memberById.get(notification.actorId)?.displayName || notification.actorId}</p><small>{formatDate(notification.createdAt)}</small></div>
            {!notification.read && <button type="button" className="admin-text-button" disabled={savingId === notification.id} onClick={() => void markNotificationRead(notification)}>Mark read</button>}
          </article>)}</div> : <div className="admin-empty">No notifications have been delivered to this account.</div>}
          {renderPagination(notifications.length, currentNotificationPage)}
        </section>}

        {!loadingData && section === "analytics" && <section className="admin-panel admin-chart-panel">
          <div className="admin-panel-heading"><div><h2>Analytics & reports</h2><p>Growth and exchange activity derived from Firestore records.</p></div><div className="admin-row-actions">
            <select aria-label="Analytics reporting interval" value={interval} onChange={(event) => setInterval(event.target.value as Interval)}><option value="daily">Daily · 30 days</option><option value="weekly">Weekly · 12 weeks</option><option value="monthly">Monthly · 12 months</option><option value="yearly">Yearly · 5 years</option></select>
            <button type="button" className="admin-button primary" onClick={exportAnalytics}>Export CSV</button>
          </div></div>
          <div className="admin-kpi-grid">
            <article className="admin-kpi-card"><span>Completion rate</span><strong>{swaps.length ? `${Math.round(completedSwaps / swaps.length * 100)}%` : "0%"}</strong><small>{completedSwaps} completed of {swaps.length} requests</small></article>
            <article className="admin-kpi-card"><span>Pending rate</span><strong>{swaps.length ? `${Math.round(pendingSwaps / swaps.length * 100)}%` : "0%"}</strong><small>{pendingSwaps} awaiting a response</small></article>
            <article className="admin-kpi-card"><span>Cancellation / decline rate</span><strong>{swaps.length ? `${Math.round(cancelledSwaps / swaps.length * 100)}%` : "0%"}</strong><small>{cancelledSwaps} cancelled or declined</small></article>
            <article className="admin-kpi-card"><span>Active members</span><strong>{activeUsers}</strong><small>{suspendedUsers} suspended accounts</small></article>
          </div>
          {chartData.some((bucket) => bucket.users + bucket.listings + bucket.swaps > 0) ? <div className={`admin-bar-chart large ${interval}`} role="img" aria-label={`New user, listing, and swap counts by ${interval}`}>
            {chartData.map((bucket) => <div className="admin-chart-column" key={bucket.key}><div className="admin-chart-bars">
              <i className="members" title={`${bucket.users} new users`} style={{ height: `${bucket.users ? Math.max(5, bucket.users / maxActivity * 100) : 0}%` }} />
              <i className="listings" title={`${bucket.listings} listings`} style={{ height: `${bucket.listings ? Math.max(5, bucket.listings / maxActivity * 100) : 0}%` }} />
              <i className="swaps" title={`${bucket.swaps} swap requests`} style={{ height: `${bucket.swaps ? Math.max(5, bucket.swaps / maxActivity * 100) : 0}%` }} />
            </div><span>{bucket.label}</span></div>)}
          </div> : <div className="admin-empty">No activity for the selected interval.</div>}
          <div className="admin-panel-grid analytics-lower">
            <section><h3>Popular categories</h3>{topCategories.length ? <div className="admin-progress-list">{topCategories.map(([name, count]) => <div key={name}><div><span>{name}</span><strong>{count}</strong></div><i><span style={{ width: `${count / maxCategory * 100}%` }} /></i></div>)}</div> : <p className="admin-muted">No category activity yet.</p>}</section>
            <section><h3>Most requested skills</h3>{popularSkills.length ? <div className="admin-compact-list">{popularSkills.map(([name, count]) => <div key={name}><span>{name}</span><strong>{count}</strong></div>)}</div> : <p className="admin-muted">No request data yet.</p>}</section>
          </div>
          <p className="admin-data-note">Retention and login activity are not available because the current user schema does not record last-seen or session events. Cancelled and declined swaps are grouped from the existing request statuses; no monetary transaction data is collected.</p>
        </section>}

        {!loadingData && section === "activity" && <section className="admin-panel admin-table-panel">
          <div className="admin-panel-heading"><div><h2>Administrative activity</h2><p>Immutable log of administrator actions, including before and after values.</p></div>
            <select aria-label="Filter admin activity by date" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setPage(0); }}><option value="all">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
          </div>
          {filteredActivity.length ? <div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Time</th><th>Administrator</th><th>Action</th><th>Record</th><th>Change summary</th></tr></thead>
            <tbody>{filteredActivity.slice(page * pageSize, (page + 1) * pageSize).map((entry) => <tr key={entry.id}>
              <td>{formatDateTime(entry.createdAt)}</td><td>{entry.actorName || entry.actorId}</td><td><span className="admin-status-pill">{entry.action.replaceAll("_", " ")}</span></td>
              <td>{entry.entityType} · <code>{entry.entityId}</code></td><td>{entry.summary}<details className="admin-log-details"><summary>Values</summary><pre>{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre></details></td>
            </tr>)}</tbody>
          </table></div> : <div className="admin-empty">No administrator actions have been recorded yet.</div>}
          {renderPagination(filteredActivity.length)}
        </section>}

        {!loadingData && section === "settings" && <div className="admin-settings-grid">
          <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Platform information</h2><p>Current deployment and data capabilities</p></div></div>
            <dl className="admin-settings-list"><div><dt>Platform</dt><dd>Skill Swap · cashless community exchange</dd></div><div><dt>Authentication</dt><dd>Firebase Authentication</dd></div><div><dt>Data store</dt><dd>Cloud Firestore</dd></div><div><dt>Registration</dt><dd>Managed in Firebase Authentication</dd></div><div><dt>Moderation mode</dt><dd>Active listings are member-visible; admins can pause or remove</dd></div></dl>
          </section>
          <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Administrator access</h2><p>Least-privilege access controls</p></div></div>
            <div className="admin-security-card"><span className="admin-security-check">✓</span><div><strong>Server-enforced authorization</strong><p>Every admin request is verified against the signed-in Firebase token and trusted Firestore role. Firestore Security Rules remain authoritative for all data reads and writes.</p></div></div>
            <div className="admin-security-card"><span className="admin-security-check">✓</span><div><strong>Admin account protection</strong><p>Administrators cannot suspend or change their own role from this panel. User deletion is intentionally unavailable because Firebase Auth accounts require a separate trusted deletion workflow.</p></div></div>
            <div className="admin-security-card"><span className="admin-security-check">i</span><div><strong>Auth and security policies</strong><p>Registration controls, password policy, MFA, and email templates are configured in Firebase Console. They are not duplicated here because Firebase Auth currently owns those settings.</p></div></div>
          </section>
          <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Data coverage</h2><p>Known schema limits—not simulated settings</p></div></div>
            <ul className="admin-limit-list"><li>Login activity and retention require a trusted last-seen or analytics event source.</li><li>Skill listings have active, paused, and removed states; there is no pending approval state.</li><li>Swap completion is counted when status is completed; the current member workflow does not yet write that status.</li><li>Custom categories, reports, and immutable admin logs use the new collections documented with this update.</li></ul>
          </section>
        </div>}
      </div>
    </section>
  </main>;
}
