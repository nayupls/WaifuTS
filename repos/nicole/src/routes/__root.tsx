import { useMemo } from 'react'
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { ClerkProvider, useAuth } from '@clerk/tanstack-react-start'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import appCss from '../styles.css?url'

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { name: 'theme-color', content: '#0b0d12' },
      { title: 'Nicole · Subscriptions' },
      {
        name: 'description',
        content: 'A tiny finance manager for your recurring subscriptions.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  const convex = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [],
  )

  // Clerk can run keyless in dev, so only a missing Convex URL hard-blocks.
  if (!convex) {
    return <SetupNotice />
  }

  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <Outlet />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  )
}

function SetupNotice() {
  return (
    <main className="setup-notice">
      <h1>Nicole isn’t configured yet</h1>
      <p>Copy <code>.env.example</code> to <code>.env.local</code> and fill in:</p>
      <ul>
        {!clerkKey && (
          <li>
            <code>VITE_CLERK_PUBLISHABLE_KEY</code> (and{' '}
            <code>CLERK_SECRET_KEY</code>) from your Clerk dashboard
          </li>
        )}
        {!convexUrl && (
          <li>
            <code>VITE_CONVEX_URL</code> — printed by <code>npx convex dev</code>
          </li>
        )}
      </ul>
      <p>See the README for the full setup walkthrough.</p>
    </main>
  )
}
