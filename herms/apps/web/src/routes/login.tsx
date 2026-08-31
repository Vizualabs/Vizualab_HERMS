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
    <main className="grid min-h-screen place-items-center bg-background px-5 py-12">
      <section className="w-full max-w-sm rounded-xl border border-border bg-card p-7 shadow-[0_1px_2px_oklch(22%_0.02_220/8%)] sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            H
          </div>
          <div>
            <p className="text-sm font-semibold leading-4">HERMS</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Equipment Rental</p>
          </div>
        </div>
        <h1 className="mt-7 text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Sign in with an active HERMS staff account.
        </p>
        <form
          className="mt-7 space-y-5"
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
              className="input mt-2"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="input mt-2"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <button type="submit" disabled={login.isPending} className="button-primary w-full">
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
