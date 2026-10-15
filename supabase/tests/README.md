# Database security tests

For a local or test database only. Never run these against the real Supabase project.

1. Create an empty Postgres database and apply `supabase/schema.sql`, then `002`–`014` in order
   (with Supabase-style `auth.uid()`, `auth.jwt()` and the `anon` / `authenticated` roles).
2. `input_rules.test.sql`: run with psql. It checks the input rules from 014 and stops with
   `FAILED:` if any rule stops working.
3. `injection.e2e.mjs`: needs PostgREST in front of the test database. Add two test users
   (Alice `1111…`, Mallory `2222…`) and give Alice the decks "Alice secret deck" and
   "O'Brien's Irish". Then:

       PGRST_URL=http://localhost:3901 PGRST_JWT_SECRET=<test secret> node supabase/tests/injection.e2e.mjs

   It signs in as Mallory and sends names with apostrophes and injection attempts through
   the same client library the app uses. With `--control` (after running
   `control_unsafe.sql` on the TEST database) it also calls a deliberately unsafe function,
   and those checks must fail: that proves the test really catches injection.
