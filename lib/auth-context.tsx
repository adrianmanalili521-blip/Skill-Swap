"use client";

// lib/auth-context.tsx
// Wraps Firebase Authentication (Email/Password + Google OAuth) in a React
// context so any component can call useAuth() instead of touching the
// Firebase SDK directly. Also creates/syncs the matching users/{uid}
// Firestore doc on sign-up, per firestore-schema.md.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  authError: unknown | null;
  signUp: (email: string, password: string, displayName: string) => Promise<User>;
  signIn: (email: string, password: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Creates the users/{uid} document the first time we see a given user,
// e.g. after email sign-up or the first-ever Google sign-in. Safe to call
// on every sign-in — it no-ops if the doc already exists.
async function ensureUserDoc(user: User) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;

  await setDoc(ref, {
    uid: user.uid,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    photoURL: user.photoURL ?? null,
    bio: "",
    skillsOffered: [],
    learningGoals: [],
    role: "user",
    status: "active",
    rating: 0,
    ratingCount: 0,
    completedExchangeCount: 0,
    sentRequestCount: 0,
    receivedRequestCount: 0,
    verified: false,
    theme: "light",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<unknown | null>(null);
  const authActionInProgress = useRef(false);
  const authStateRevision = useRef(0);
  const resolvedAuthUid = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    async function syncAuthState(firebaseUser: User | null) {
      const revision = ++authStateRevision.current;
      setLoading(true);
      setAuthError(null);

      try {
        if (firebaseUser) await ensureUserDoc(firebaseUser);
        if (!active || revision !== authStateRevision.current || authActionInProgress.current) return;

        resolvedAuthUid.current = firebaseUser?.uid ?? null;
        setUser(firebaseUser);
      } catch (error) {
        if (!active || revision !== authStateRevision.current || authActionInProgress.current) return;

        setUser(null);
        setAuthError(error);
      } finally {
        if (active && revision === authStateRevision.current && !authActionInProgress.current) {
          setLoading(false);
        }
      }
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (authActionInProgress.current) return;
      if (resolvedAuthUid.current === (firebaseUser?.uid ?? null)) return;
      void syncAuthState(firebaseUser);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function completeAuthentication(operation: () => Promise<User>) {
    const revision = ++authStateRevision.current;
    authActionInProgress.current = true;
    setLoading(true);
    setAuthError(null);

    try {
      const authenticatedUser = await operation();
      await ensureUserDoc(authenticatedUser);
      resolvedAuthUid.current = authenticatedUser.uid;
      setUser(authenticatedUser);
      return authenticatedUser;
    } finally {
      authActionInProgress.current = false;
      if (revision === authStateRevision.current) setLoading(false);
    }
  }

  async function signUp(email: string, password: string, displayName: string) {
    return completeAuthentication(async () => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) await updateProfile(cred.user, { displayName });
      return cred.user;
    });
  }

  async function signIn(email: string, password: string) {
    return completeAuthentication(async () => {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return cred.user;
    });
  }

  async function signInWithGoogle() {
    return completeAuthentication(async () => {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      return cred.user;
    });
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  const value: AuthContextValue = {
    user,
    loading,
    authError,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
