import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  subscriptions: defineTable({
    userId: v.string(),
    email: v.string(),
    service: v.string(),
    paymentDetails: v.string(),
    /** Price per billing cycle, in minor units (cents) to avoid float drift. */
    amountCents: v.number(),
    currency: v.union(v.literal('EUR'), v.literal('USD'), v.literal('GBP')),
    cycle: v.union(v.literal('monthly'), v.literal('yearly')),
    /** Day of month the charge happens, 1-31 (clamped to month length). */
    billingDay: v.number(),
    /** Month of the charge for yearly cycles, 1-12. Unset for monthly. */
    billingMonth: v.optional(v.number()),
  }).index('by_user', ['userId']),
})
