import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []
    return await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', identity.subject))
      .order('desc')
      .collect()
  },
})

export const add = mutation({
  args: {
    email: v.string(),
    service: v.string(),
    paymentDetails: v.string(),
    amountCents: v.number(),
    currency: v.union(v.literal('EUR'), v.literal('USD'), v.literal('GBP')),
    cycle: v.union(v.literal('monthly'), v.literal('yearly')),
    billingDay: v.number(),
    billingMonth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Not signed in')

    const service = args.service.trim()
    const email = args.email.trim()
    if (!service) throw new Error('Service is required')
    if (!email) throw new Error('Email is required')
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
      throw new Error('Amount must be a positive number')
    }
    if (!Number.isInteger(args.billingDay) || args.billingDay < 1 || args.billingDay > 31) {
      throw new Error('Billing day must be between 1 and 31')
    }
    if (args.cycle === 'yearly') {
      if (
        args.billingMonth === undefined ||
        !Number.isInteger(args.billingMonth) ||
        args.billingMonth < 1 ||
        args.billingMonth > 12
      ) {
        throw new Error('Yearly subscriptions need a billing month between 1 and 12')
      }
    }

    return await ctx.db.insert('subscriptions', {
      userId: identity.subject,
      email,
      service,
      paymentDetails: args.paymentDetails.trim(),
      amountCents: args.amountCents,
      currency: args.currency,
      cycle: args.cycle,
      billingDay: args.billingDay,
      billingMonth: args.cycle === 'yearly' ? args.billingMonth : undefined,
    })
  },
})

export const remove = mutation({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Not signed in')
    const sub = await ctx.db.get(args.id)
    if (!sub || sub.userId !== identity.subject) throw new Error('Not found')
    await ctx.db.delete(args.id)
  },
})
