import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import appCss from '../styles.css?url'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'HERMS | Hotel Equipment Rental Management System',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
})

function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-12 text-foreground">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">404</p>
        <h1 className="mt-3 text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The HERMS page you requested does not exist or the link is no longer valid.
        </p>
        <Link to="/" className="button-primary mt-6 inline-flex">
          Return to HERMS
        </Link>
      </section>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
