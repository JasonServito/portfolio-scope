-- A partial unique index keeps the public-demo selector unambiguous while
-- allowing every normal user to retain the default false marker.
CREATE UNIQUE INDEX "User_single_demo_owner_key"
ON "User" ("isDemo")
WHERE "isDemo" = true;
