-- The account's watchlist and price alerts, and the devices to push to when an alert fires.
CREATE TABLE "investing_settings" (
    "user_id" UUID NOT NULL,
    "watchlist" JSONB NOT NULL,
    "alerts" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "investing_settings_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "push_tokens" (
    "token" VARCHAR(200) NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" VARCHAR(7) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

ALTER TABLE "investing_settings" ADD CONSTRAINT "investing_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
