# Auth Flow Manual QA

Use a Supabase project with email confirmation enabled when checking confirmation behavior.

## Login

1. Open `/auth/login`.
2. Submit valid credentials and confirm the app redirects to `/dashboard`.
3. Open a protected route while signed out and confirm login receives a `next` query parameter.
4. Sign in from that screen and confirm the app returns to the original protected route.
5. Try an unconfirmed account and confirm the resend verification action appears.

## Signup And Email Confirmation

1. Open `/auth/register`.
2. Confirm registration blocks invalid email, weak password, and mismatched password confirmation.
3. Register a student account and confirm the post-signup check-email state appears when Supabase returns no session.
4. Use the resend verification email action and confirm Supabase sends another signup confirmation email.
5. Follow the verification email link and confirm the app lands on login or the intended `next` destination.

## Password Recovery

1. Open `/auth/forgot-password`.
2. Submit an invalid email and confirm inline validation appears.
3. Submit a valid account email and confirm the success message appears.
4. Follow the recovery email link and confirm `/auth/reset-password` accepts a new password only when it meets the inline requirements and confirmation matches.
5. Continue after updating the password and confirm login with the new password works.
