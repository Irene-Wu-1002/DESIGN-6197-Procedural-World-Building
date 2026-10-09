import { useRef, useState } from 'react'
import {
  describeAuthError,
  resetPassword,
  signIn,
  signOut,
  signUp,
  useAuthUser,
} from '../services/auth'
import './AccountMenu.css'

const MODES = {
  signIn: { title: 'Sign in', submit: 'Sign in' },
  signUp: { title: 'Create account', submit: 'Create account' },
  reset: { title: 'Reset password', submit: 'Send reset email' },
}

// Account button in the site header; opens a sign-in dialog.
export default function AccountMenu() {
  const { user, loading } = useAuthUser()
  const dialogRef = useRef(null)
  const [mode, setMode] = useState('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const openDialog = () => {
    setError('')
    setNotice('')
    dialogRef.current?.showModal()
  }

  const closeDialog = () => {
    dialogRef.current?.close()
    setPassword('')
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setNotice('')
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'signIn' || mode === 'signUp') {
        const submit = mode === 'signIn' ? signIn : signUp
        await submit(email.trim(), password)
        closeDialog()
      } else {
        await resetPassword(email.trim())
        setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`)
      }
    } catch (authError) {
      setError(describeAuthError(authError))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  return (
    <div className="account">
      {user ? (
        <div className="account-chip">
          <span className="account-email" title={user.email}>
            {user.email}
          </span>
          <button type="button" className="layer-add" onClick={signOut}>
            Sign out
          </button>
        </div>
      ) : (
        <button type="button" className="account-chip account-open" onClick={openDialog}>
          Sign in
        </button>
      )}

      <dialog
        ref={dialogRef}
        className="account-dialog"
        aria-labelledby="account-dialog-title"
        onClick={(event) => {
          // Clicking the backdrop (outside the form) closes the dialog.
          if (event.target === dialogRef.current) closeDialog()
        }}
        onClose={() => setPassword('')}
      >
        <form className="account-form" onSubmit={onSubmit}>
          <div className="account-header">
            <h2 id="account-dialog-title">{MODES[mode].title}</h2>
            <button
              type="button"
              className="account-close"
              aria-label="Close"
              onClick={closeDialog}
            >
              ×
            </button>
          </div>

          <label className="account-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {mode !== 'reset' && (
            <label className="account-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                minLength={mode === 'signUp' ? 6 : undefined}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {mode === 'signUp' && <small>At least 6 characters.</small>}
            </label>
          )}

          {error && (
            <p className="account-message account-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="account-message" role="status">
              {notice}
            </p>
          )}

          <button type="submit" className="account-submit" disabled={busy}>
            {busy ? 'Please wait…' : MODES[mode].submit}
          </button>

          <div className="account-links">
            {mode === 'signIn' && (
              <>
                <button type="button" onClick={() => switchMode('reset')}>
                  Forgot password?
                </button>
                <button type="button" onClick={() => switchMode('signUp')}>
                  Create an account
                </button>
              </>
            )}
            {mode !== 'signIn' && (
              <button type="button" onClick={() => switchMode('signIn')}>
                Back to sign in
              </button>
            )}
          </div>
        </form>
      </dialog>
    </div>
  )
}
