-- An operator can disable an account (docs/design/17-admin.md): set, the account cannot sign in or use a session.
ALTER TABLE "users" ADD COLUMN "disabled_at" TIMESTAMPTZ(3);
