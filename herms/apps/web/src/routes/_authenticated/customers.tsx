import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ApiError, api } from '../../api'
import { customersQuery, queryKeys } from '../../queries'

export const Route = createFileRoute('/_authenticated/customers')({
  component: CustomersPage,
})

function CustomersPage() {
  const customers = useQuery(customersQuery)
  const queryClient = useQueryClient()
  const createCustomer = useMutation({
    mutationFn: api.createCustomer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers })
    },
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <section>
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Master data</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Customers</h1>
        <p className="mt-2 text-muted-foreground">
          Maintain New and Recurring customers and their fixed equipment price lists.
        </p>
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          {customers.isPending && <p className="p-6 text-muted-foreground">Loading customers…</p>}
          {customers.error && (
            <p role="alert" className="p-6 text-danger">
              {customers.error instanceof ApiError ? customers.error.message : 'Unable to load customers'}
            </p>
          )}
          {customers.data?.length === 0 && (
            <p className="p-6 text-muted-foreground">No customers have been created.</p>
          )}
          <ul className="divide-y divide-border">
            {customers.data?.map((customer) => (
              <li key={customer.id}>
                <Link
                  to="/customers/$customerId"
                  params={{ customerId: customer.id }}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted"
                >
                  <div>
                    <p className="font-medium">{customer.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {customer.email || customer.phone || 'No contact details'}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold capitalize text-primary-strong">
                    {customer.type}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <aside className="h-fit rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Add customer</h2>
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            createCustomer.mutate({
              name: String(form.get('name') ?? ''),
              type: 'new',
              email: String(form.get('email') ?? ''),
              phone: String(form.get('phone') ?? ''),
              address: String(form.get('address') ?? ''),
            })
            if (!createCustomer.isError) event.currentTarget.reset()
          }}
        >
          <Field label="Name" name="name" required />
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            Customers start as New. Add a complete fixed price list from their detail page to make them Recurring.
          </p>
          <Field label="Email" name="email" type="email" />
          <Field label="Phone" name="phone" />
          <Field label="Address" name="address" />
          {createCustomer.error && (
            <p role="alert" className="text-sm text-danger">
              {createCustomer.error instanceof ApiError
                ? createCustomer.error.message
                : 'Unable to create customer'}
            </p>
          )}
          <button type="submit" disabled={createCustomer.isPending} className="button-primary w-full">
            {createCustomer.isPending ? 'Creating…' : 'Create customer'}
          </button>
        </form>
      </aside>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input name={name} type={type} required={required} className="input mt-2" />
    </label>
  )
}
