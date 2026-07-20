import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Show,
  SignInButton,
  UserButton,
  useUser,
} from '@clerk/tanstack-react-start'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import {
  type Currency,
  type Cycle,
  formatCents,
  formatTotals,
  monthName,
  nextChargeDate,
  parseAmountToCents,
  totalsByCurrency,
} from '../lib/billing'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Nicole</h1>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>
      <Show when="signed-out">
        <main className="hero">
          <p className="hero-tag">Your subscriptions, one glance.</p>
          <p className="hero-sub">
            Track what each service costs per month and per year, and see what’s
            about to hit your card.
          </p>
          <SignInButton mode="modal">
            <button className="btn btn-primary btn-lg">Sign in to start</button>
          </SignInButton>
        </main>
      </Show>
      <Show when="signed-in">
        <Dashboard />
      </Show>
    </div>
  )
}

function Dashboard() {
  const subs = useQuery(api.subscriptions.list)
  const [formOpen, setFormOpen] = useState(false)

  if (subs === undefined) {
    return <main className="loading">Loading…</main>
  }

  const now = new Date()
  const totals = totalsByCurrency(subs, now)

  return (
    <main className="dashboard">
      <section className="summary" aria-label="Cost summary">
        <SummaryCard
          label="per month"
          value={formatTotals(totals, (t) => t.perMonthCents)}
          hint="yearly plans averaged"
        />
        <SummaryCard
          label="per year"
          value={formatTotals(totals, (t) => t.perYearCents)}
        />
        <SummaryCard
          label={monthName(now.getMonth())}
          value={formatTotals(totals, (t) => t.thisMonthCents)}
          hint="charged this month"
        />
        <SummaryCard
          label={monthName(now.getMonth() + 1)}
          value={formatTotals(totals, (t) => t.nextMonthCents)}
          hint="charged next month"
        />
      </section>

      {formOpen ? (
        <AddForm onDone={() => setFormOpen(false)} />
      ) : (
        <button
          className="btn btn-primary btn-block"
          onClick={() => setFormOpen(true)}
        >
          + Add subscription
        </button>
      )}

      <SubscriptionList subs={subs} now={now} />
    </main>
  )
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="summary-card">
      <span className="summary-label">{label}</span>
      <span className="summary-value">{value}</span>
      {hint ? <span className="summary-hint">{hint}</span> : null}
    </div>
  )
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

function AddForm({ onDone }: { onDone: () => void }) {
  const { user } = useUser()
  const add = useMutation(api.subscriptions.add)

  const [email, setEmail] = useState(
    user?.primaryEmailAddress?.emailAddress ?? '',
  )
  const [service, setService] = useState('')
  const [paymentDetails, setPaymentDetails] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('EUR')
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [billingDay, setBillingDay] = useState(1)
  const [billingMonth, setBillingMonth] = useState(new Date().getMonth() + 1)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amountCents = parseAmountToCents(amount)
    if (amountCents === null) {
      setError('Enter a valid amount, e.g. 12.99')
      return
    }
    setSaving(true)
    try {
      await add({
        email,
        service,
        paymentDetails,
        amountCents,
        currency,
        cycle,
        billingDay,
        billingMonth: cycle === 'yearly' ? billingMonth : undefined,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <h2>New subscription</h2>

      <label className="field">
        <span>Service</span>
        <input
          value={service}
          onChange={(e) => setService(e.target.value)}
          placeholder="Netflix, Spotify, iCloud…"
          required
          autoFocus
        />
      </label>

      <label className="field">
        <span>Account email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </label>

      <label className="field">
        <span>Payment details</span>
        <input
          value={paymentDetails}
          onChange={(e) => setPaymentDetails(e.target.value)}
          placeholder="Visa ····4242, PayPal…"
        />
      </label>

      <div className="field-row">
        <label className="field grow">
          <span>Amount</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="12.99"
            required
          />
        </label>
        <label className="field">
          <span>Currency</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
          >
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
            <option value="GBP">GBP £</option>
          </select>
        </label>
      </div>

      <div className="field">
        <span className="field-label">Billing cycle</span>
        <div className="segmented" role="group" aria-label="Billing cycle">
          <button
            type="button"
            className={cycle === 'monthly' ? 'active' : ''}
            onClick={() => setCycle('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            className={cycle === 'yearly' ? 'active' : ''}
            onClick={() => setCycle('yearly')}
          >
            Yearly
          </button>
        </div>
      </div>

      <div className="field-row">
        {cycle === 'yearly' && (
          <label className="field grow">
            <span>Month</span>
            <select
              value={billingMonth}
              onChange={(e) => setBillingMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {monthName(i)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field grow">
          <span>Day of month</span>
          <select
            value={billingDay}
            onChange={(e) => setBillingDay(Number(e.target.value))}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary grow" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function SubscriptionList({
  subs,
  now,
}: {
  subs: Array<Doc<'subscriptions'>>
  now: Date
}) {
  if (subs.length === 0) {
    return (
      <p className="empty">
        No subscriptions yet. Add your first one to see the numbers.
      </p>
    )
  }
  return (
    <ul className="sub-list">
      {subs.map((sub) => (
        <SubscriptionCard key={sub._id} sub={sub} now={now} />
      ))}
    </ul>
  )
}

function SubscriptionCard({
  sub,
  now,
}: {
  sub: Doc<'subscriptions'>
  now: Date
}) {
  const remove = useMutation(api.subscriptions.remove)
  const [confirming, setConfirming] = useState(false)

  const next = nextChargeDate(sub, now)
  const nextLabel = next.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })

  async function handleRemove(id: Id<'subscriptions'>) {
    await remove({ id })
  }

  return (
    <li className="sub-card">
      <div className="sub-main">
        <div className="sub-title-row">
          <span className="sub-service">{sub.service}</span>
          <span className="sub-amount">
            {formatCents(sub.amountCents, sub.currency)}
            <span className="sub-cycle">/{sub.cycle === 'monthly' ? 'mo' : 'yr'}</span>
          </span>
        </div>
        <div className="sub-meta">
          <span>{sub.email}</span>
          {sub.paymentDetails ? <span>{sub.paymentDetails}</span> : null}
          <span className="sub-next">next: {nextLabel}</span>
        </div>
      </div>
      <div className="sub-actions">
        {confirming ? (
          <>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => handleRemove(sub._id)}
            >
              Delete
            </button>
            <button className="btn btn-sm" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm"
            aria-label={`Remove ${sub.service}`}
            onClick={() => setConfirming(true)}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  )
}
