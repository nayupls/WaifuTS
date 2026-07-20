export default {
  providers: [
    {
      // Your Clerk Frontend API URL, e.g. https://your-app.clerk.accounts.dev
      // Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard (not in .env.local).
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: 'convex',
    },
  ],
}
