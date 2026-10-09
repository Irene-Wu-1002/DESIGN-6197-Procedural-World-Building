// Email/password sign-in with Firebase Authentication.
// Methods enabled in the Firebase Console: Email/Password only.
import { useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth } from '../lib/firebase'

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function signUp(email, password) {
  return createUserWithEmailAndPassword(auth, email, password)
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email)
}

export function signOut() {
  return firebaseSignOut(auth)
}

/**
 * Current user, or null when signed out. `loading` stays true until Firebase
 * restores a saved session on page load, so the UI doesn't flash "Sign in".
 */
export function useAuthUser() {
  const [state, setState] = useState({ user: auth.currentUser, loading: true })

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => setState({ user, loading: false })),
    []
  )

  return state
}

const ERROR_MESSAGES = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
  'auth/weak-password': 'Use at least 6 characters for the password.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
}

export function describeAuthError(error) {
  return ERROR_MESSAGES[error?.code] ?? 'Something went wrong. Please try again.'
}
