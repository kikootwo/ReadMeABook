/**
 * Component: Add Local User Dialog (Users page)
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { fetchJSON } from '@/lib/utils/api';

interface AddUserDialogProps {
  onClose: () => void;
  /** Called with the new user's stored (lowercased) username once the account exists */
  onAdded: (username: string) => void;
  /** Gets focus back when the dialog closes (the Add User button) */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

type InputField = 'username' | 'password' | 'confirm';
type Field = InputField | 'form';
type FieldErrors = Partial<Record<Field, string>>;

export const PASSWORD_MISMATCH_ERROR = 'Passwords do not match';

const INPUT_FIELDS: readonly InputField[] = ['username', 'password', 'confirm'];

/** Which field a server message belongs under */
function fieldFor(message: string): Field {
  if (/username/i.test(message)) return 'username';
  if (/password/i.test(message)) return 'password';
  return 'form';
}

const inputClass = (hasError: boolean) =>
  `block w-full px-3 py-2.5 rounded-lg border bg-white dark:bg-gray-900 text-base sm:text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 transition-colors ${
    hasError
      ? 'border-red-500 focus:ring-red-500'
      : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
  }`;

/** The Users page header button that opens the dialog */
export function AddUserButton({ onClick, ref }: { onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg transition-colors text-sm font-medium"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
      <span>Add User</span>
    </button>
  );
}

export function AddUserDialog({ onClose, onAdded, returnFocusRef }: AddUserDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  /** The field to focus once the errors render and the inputs are enabled again */
  const pendingFocus = useRef<InputField | null>(null);

  const close = () => {
    if (submitting) return;
    returnFocusRef?.current?.focus();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submitting) return;
      returnFocusRef?.current?.focus();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting, returnFocusRef]);

  useEffect(() => {
    const field = pendingFocus.current;
    if (!field || submitting) return;
    pendingFocus.current = null;
    const refs = { username: usernameRef, password: passwordRef, confirm: confirmRef };
    refs[field].current?.focus();
  }, [errors, submitting]);

  /** Shows the errors and moves focus to the first field with one (the first field for a form-level error) */
  const showErrors = (next: FieldErrors) => {
    pendingFocus.current = INPUT_FIELDS.find((field) => next[field]) ?? 'username';
    setErrors(next);
  };

  const clearError = (field: Field) =>
    setErrors((prev) => (prev[field] || prev.form ? { ...prev, [field]: undefined, form: undefined } : prev));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (password !== confirm) {
      showErrors({ confirm: PASSWORD_MISMATCH_ERROR });
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const result = await fetchJSON<{ user: { plexUsername: string } }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      returnFocusRef?.current?.focus();
      onAdded(result.user.plexUsername);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to add user';
      showErrors({ [fieldFor(message)]: message });
      setSubmitting(false);
    }
  };

  const fieldError = (field: InputField) =>
    errors[field] ? (
      <p id={`add-user-${field}-error`} role="alert" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  const describedBy = (field: InputField) => (errors[field] ? `add-user-${field}-error` : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* A sibling of the dialog, not its parent: a text selection dragged from a field out to here clicks their common parent instead */}
      <div data-testid="add-user-backdrop" aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-user-title"
        className="relative bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md"
      >
        <form onSubmit={handleSubmit} noValidate>
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 id="add-user-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Add User
            </h3>
            <button
              type="button"
              onClick={close}
              className="p-2 -mr-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Close dialog"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-5 py-5 space-y-4">
            <div>
              <label htmlFor="add-user-username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Username
              </label>
              <input
                ref={usernameRef}
                id="add-user-username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearError('username');
                }}
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={submitting}
                aria-invalid={errors.username ? 'true' : 'false'}
                aria-describedby={describedBy('username')}
                className={inputClass(!!errors.username)}
              />
              {fieldError('username')}
            </div>
            <div>
              <label htmlFor="add-user-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Password
              </label>
              <input
                ref={passwordRef}
                id="add-user-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError('password');
                }}
                autoComplete="new-password"
                disabled={submitting}
                aria-invalid={errors.password ? 'true' : 'false'}
                aria-describedby={describedBy('password')}
                className={inputClass(!!errors.password)}
              />
              {fieldError('password')}
            </div>
            <div>
              <label htmlFor="add-user-confirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Confirm Password
              </label>
              <input
                ref={confirmRef}
                id="add-user-confirm"
                type="password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  clearError('confirm');
                }}
                autoComplete="new-password"
                disabled={submitting}
                aria-invalid={errors.confirm ? 'true' : 'false'}
                aria-describedby={describedBy('confirm')}
                className={inputClass(!!errors.confirm)}
              />
              {fieldError('confirm')}
            </div>
            {errors.form && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {errors.form}
              </p>
            )}
          </div>

          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
