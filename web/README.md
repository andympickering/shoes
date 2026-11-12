This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Private site access

The archive uses Supabase email/password authentication. All archive pages and
data APIs require a valid session; only the sign-in and authentication callback
routes, alert email links, and the separately protected alert-delivery endpoint
are public.

Configure these public Supabase project values in the web deployment and in
`web/.env.local` for local development:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The web server also needs `SUPABASE_SERVICE_KEY` for protected article reads.
Keep this server-only; never prefix it with `NEXT_PUBLIC_`. Apply the Supabase
migration `014_private_archive.sql` before deploying the gate so anonymous
database table/RPC reads are revoked.

After deploying, check the site in a private browser window: the home page
should redirect to `/login`, and an unauthenticated request to `/api/articles`
should return HTTP 401. Next.js discovers the access middleware at
`web/src/middleware.ts` alongside `src/app`.

In Supabase Authentication settings:

1. Enable the Email provider and disable **Allow new users to sign up**. This
   makes account creation invite-only; hiding the signup button by itself is
   not an access-control measure.
2. Set the Site URL to the site's origin and add
   `https://your-site.example/auth/callback` to the allowed redirect URLs (also
   add `http://localhost:3000/auth/callback` for local testing).
3. Invite users from Authentication > Users. The default Supabase invitation
   link redirects to the Site URL, where the app exchanges the returned session
   for password setup. The redirect URL may also be set to `/auth/callback`.
   Alternatively, to use the server-side token-hash callback, update the
   **Invite user** email template's link to:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=invite">
     Accept invitation
   </a>
   ```

   Invited users follow the link and set a password before accessing the archive.
   The same flow supports Supabase password-recovery links. If a link has
   already been used or has expired, use **Set or reset your password** on the
   login page to request a new link. Recovery links use the Site URL, which
   should be an allowed redirect URL.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
