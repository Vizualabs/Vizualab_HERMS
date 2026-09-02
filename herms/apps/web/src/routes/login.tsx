import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { ApiError, api } from '../api'
import { queryKeys, sessionQuery } from '../queries'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const session = useQuery(sessionQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[61%_39%]">
      <section className="app-sidebar hidden min-h-screen flex-col px-12 py-12 lg:flex xl:px-14">
        <div className="flex items-center gap-3 text-sidebar-accent-foreground">
          <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            H
          </div>
          <p className="text-sm font-semibold">HERMS</p>
        </div>

        <div className="flex flex-1 items-center">
          <div className="max-w-xl pb-5">
            <h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground">
              Every spoon, plate and bowl accounted for.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-sidebar-foreground/80">
              Hotel Equipment Rental Management System — built for reliable rental operations.
            </p>

            <ul className="mt-10 space-y-6" aria-label="HERMS capabilities">
              <LoginFeature icon="notes">
                Delivery and retention notes submitted by field staff, approved by the store admin before stock moves.
              </LoginFeature>
              <LoginFeature icon="stock">
                Live stock quantity and value, with a complete discrepancy and damage registry.
              </LoginFeature>
              <LoginFeature icon="finance">
                Pending payments, monthly income versus expenses, and automatic price escalation.
              </LoginFeature>
            </ul>
          </div>
        </div>

        <p className="text-xs text-sidebar-foreground/60">Vizualabs (Pvt) Ltd · info@vizualabs.com</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-10 lg:min-h-0">
        <div className="w-full max-w-[30rem]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              H
            </div>
            <div>
              <p className="text-sm font-semibold leading-4">HERMS</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Equipment Rental</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">Use your HERMS staff account.</p>

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
                className="input mt-2 h-12"
              />
            </label>
            <div>
              <label htmlFor="password" className="block text-sm font-medium">
                Password
              </label>
              <div className="relative mt-2">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="input h-12 pr-12"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={showPassword ? 'Hide entered characters' : 'Show entered characters'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}
            <button type="submit" disabled={login.isPending} className="button-primary h-12 w-full">
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}

function LoginFeature({ icon, children }: { icon: 'notes' | 'stock' | 'finance'; children: ReactNode }) {
  return (
    <li className="flex max-w-xl items-start gap-4 text-sm leading-6 text-sidebar-accent-foreground">
      <LoginFeatureIcon name={icon} />
      <span>{children}</span>
    </li>
  )
}

function LoginFeatureIcon({ name }: { name: 'notes' | 'stock' | 'finance' }) {
  const className = 'mt-0.5 size-5 shrink-0 text-sidebar-primary'

  if (name === 'notes') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5V3h6v1.5M9 12l2 2 4-5" />
      </svg>
    )
  }

  if (name === 'stock') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 4 2.3v4.6L12 12.2 8 9.9V5.3L12 3Zm-6 9 4 2.3v4.6L6 21.2 2 18.9v-4.6L6 12Zm12 0 4 2.3v4.6l-4 2.3-4-2.3v-4.6l4-2.3ZM8 5.3l4 2.3 4-2.3M2 14.3l4 2.3 4-2.3m4 0 4 2.3 4-2.3" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M7 15l4-4 3 2 5-6" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 4 16 16M10.6 6.1A10.5 10.5 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.1 2.8M6.2 7.4A17.5 17.5 0 0 0 2.5 12s3.5 6 9.5 6a10.4 10.4 0 0 0 3.3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}
