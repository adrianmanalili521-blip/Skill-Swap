// lib/auth-errors.ts
// Maps Firebase Auth error codes to user-friendly messages.
// Your teammates can use this in the login/signup forms, e.g.:
//   catch (err) { setError(getAuthErrorMessage(err)); }

import { FirebaseError } from "firebase/app";

const MESSAGES: Record<string, string> = {
  "auth/invalid-api-key": "Firebase rejected this app's API key. Check NEXT_PUBLIC_FIREBASE_API_KEY in .env.local.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase rejected this app's API key. Check NEXT_PUBLIC_FIREBASE_API_KEY in .env.local.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/user-not-found": "No account found with this email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Authentication settings.",
  "auth/unauthorized-domain": "This site is not authorized for Firebase sign-in. Add its hostname under Firebase Authentication settings.",
  "permission-denied": "Firebase blocked access to the user profile in Firestore. Check Firestore rules; the Auth account may already exist, so try signing in.",
};

export function getAuthErrorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    return MESSAGES[err.code] ?? `Firebase error (${err.code}). Check Firebase Authentication settings and Firestore rules.`;
  }
  return err instanceof Error
    ? `Unexpected error: ${err.message}`
    : "Unexpected error. Please try again.";
}
