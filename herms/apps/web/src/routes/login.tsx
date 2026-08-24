import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { ApiError, api } from '../api'
import { queryKeys, sessionQuery } from '../queries'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const session = useQuery(sessionQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const login = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: async (user) => {
      queryClient.setQueryData(queryKeys.session, user)
      await navigate({ to: '/' })
    },
    onError: (cause) => {
      setError(cause instanceof ApiError ? cause.message : 'Unable to sign in')
    },
  })

  if (session.data) return <Navigate to="/" />

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-xl shadow-shadow/10">
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-primary">HERMS</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Sign in with an active HERMS staff account.
        </p>
        <form
          className="mt-8 space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            const form = new FormData(event.currentTarget)
            login.mutate({
              email: String(form.get('email') ?? ''),
              password: String(form.get('password') ?? ''),
            })
          }}
        >
          <label className="block text-sm font-medium">
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={login.isPending}
            className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
