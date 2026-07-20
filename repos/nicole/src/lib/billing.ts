export type Cycle = 'monthly' | 'yearly'
export type Currency = 'EUR' | 'USD' | 'GBP'

export interface SubscriptionLike {
  amountCents: number
  currency: Currency
  cycle: Cycle
  /** Day of month the charge happens, 1-31 (clamped to month length). */
  billingDay: number
  /** Month of the charge for yearly cycles, 1-12. */
  billingMonth?: number
}

export interface CurrencyTotals {
  /** Average cost per month (yearly subscriptions spread over 12 months). */
  perMonthCents: number
  /** Total cost over a full year. */
  perYearCents: number
  /** Charges that actually land in the current calendar month. */
  thisMonthCents: number
  /** Charges that actually land in the next calendar month. */
  nextMonthCents: number
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

/** The actual day a subscription charges in a given month (Feb 31 -> Feb 28/29). */
export function chargeDayInMonth(
  sub: SubscriptionLike,
  year: number,
  month0: number,
): number {
  return Math.min(sub.billingDay, daysInMonth(year, month0))
}

/** Whether a subscription produces a charge in the given calendar month. */
export function chargesInMonth(sub: SubscriptionLike, month0: number): boolean {
  if (sub.cycle === 'monthly') return true
  return sub.billingMonth === month0 + 1
}

/** The next date this subscription will charge, on or after `from`. */
export function nextChargeDate(sub: SubscriptionLike, from: Date): Date {
  let year = from.getFullYear()
  let month0 = from.getMonth()
  for (let i = 0; i < 13; i++) {
    if (chargesInMonth(sub, month0)) {
      const day = chargeDayInMonth(sub, year, month0)
      const candidate = new Date(year, month0, day)
      if (
        candidate.getTime() >=
        new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
      ) {
        return candidate
      }
    }
    month0++
    if (month0 > 11) {
      month0 = 0
      year++
    }
  }
  // Unreachable: every subscription charges at least once in any 13-month span.
  return new Date(year, month0, sub.billingDay)
}

export function totalsByCurrency(
  subs: ReadonlyArray<SubscriptionLike>,
  now: Date = new Date(),
): Map<Currency, CurrencyTotals> {
  const thisMonth0 = now.getMonth()
  const nextMonth0 = (thisMonth0 + 1) % 12
  const totals = new Map<Currency, CurrencyTotals>()
  for (const sub of subs) {
    let t = totals.get(sub.currency)
    if (!t) {
      t = { perMonthCents: 0, perYearCents: 0, thisMonthCents: 0, nextMonthCents: 0 }
      totals.set(sub.currency, t)
    }
    if (sub.cycle === 'monthly') {
      t.perMonthCents += sub.amountCents
      t.perYearCents += sub.amountCents * 12
    } else {
      t.perMonthCents += sub.amountCents / 12
      t.perYearCents += sub.amountCents
    }
    if (chargesInMonth(sub, thisMonth0)) t.thisMonthCents += sub.amountCents
    if (chargesInMonth(sub, nextMonth0)) t.nextMonthCents += sub.amountCents
  }
  return totals
}

export function formatCents(cents: number, currency: Currency): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

/** Format one figure across currencies, e.g. "€12.99 + $5.00". */
export function formatTotals(
  totals: Map<Currency, CurrencyTotals>,
  pick: (t: CurrencyTotals) => number,
): string {
  if (totals.size === 0) return formatCents(0, 'EUR')
  return [...totals.entries()]
    .map(([currency, t]) => formatCents(pick(t), currency))
    .join(' + ')
}

export function parseAmountToCents(input: string): number | null {
  const normalized = input.trim().replace(/,/g, '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const cents = Math.round(parseFloat(normalized) * 100)
  return cents > 0 ? cents : null
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export function monthName(month0: number): string {
  return MONTH_NAMES[((month0 % 12) + 12) % 12] as string
}
