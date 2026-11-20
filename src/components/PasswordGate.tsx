import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { verifyPasscode } from '../lib/api';

interface PasswordGateProps {
  onUnlocked: () => void;
}

export function PasswordGate({ onUnlocked }: PasswordGateProps) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) {
      setError('Enter your ReelMaker passphrase.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const ok = await verifyPasscode(passcode.trim());
      if (ok) {
        onUnlocked();
      } else {
        setError('Incorrect passphrase. Try again.');
      }
    } catch {
      setError('Could not verify passphrase. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0C0D10] px-4">
      <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#14161B] p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F5B700]/15 text-[#F5B700]">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-[#F4F4F5]">
              ReelMaker
            </h1>
            <p className="text-xs text-[#9CA3AF]">Personal Studio Access</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="studio-passcode"
              className="mb-1.5 block text-sm font-medium text-[#D1D5DB]"
            >
              Passphrase
            </label>
            <input
              id="studio-passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Enter personal passphrase"
              autoFocus
              className="w-full rounded-lg border border-white/[0.12] bg-[#0C0D10] px-4 py-2.5 text-sm text-[#F4F4F5] placeholder:text-[#6B7280] focus:border-[#F5B700] focus:outline-none"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[#F87171]">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#F5B700] px-4 py-2.5 text-sm font-semibold text-[#0C0D10] hover:bg-[#FFC926] disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Unlocking...' : 'Unlock Studio'}
          </button>
        </form>
      </div>
    </main>
  );
}
