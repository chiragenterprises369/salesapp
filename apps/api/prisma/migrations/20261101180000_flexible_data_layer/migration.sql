-- Flexible data layer + Industry Packs (Part 1). Hand-edited from `prisma migrate diff`:
--  * CustomField.entity is RENAMED to target (values kept) and options move into config.options.
--  * Pipeline.key is backfilled ("sales" for the default pipeline) before it becomes NOT NULL.
--  * Existing default pipelines and shipped WhatsApp templates are adopted by the core pack generic-sales.
--  * System roles get the new records.* permissions; Super Admins with flag rights get platform.packs.manage.
-- The pack itself (fields, registry rows, WorkspacePack rows) is applied by `pnpm packs:sync`, not here.

-- ---------------------------------------------------------------- custom fields on more core entities
ALTER TABLE "Call" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Company" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Deal" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Task" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------- CustomField: entity -> target, options -> config
ALTER TABLE "CustomField" RENAME COLUMN "entity" TO "target";
ALTER INDEX "CustomField_workspaceId_entity_key_key" RENAME TO "CustomField_workspaceId_target_key_key";
ALTER TABLE "CustomField"
ADD COLUMN "access" JSONB NOT NULL DEFAULT '{"hiddenFor": [], "readOnlyFor": []}',
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "customObjectId" UUID,
ADD COLUMN "helpText" TEXT,
ADD COLUMN "isUnique" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "packKey" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Default only backfills existing rows; Prisma sets @updatedAt itself.
ALTER TABLE "CustomField" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- select options: ["Hot lead"] -> { "options": [{ "value": "hot_lead", "label": "Hot lead" }] }
UPDATE "CustomField" cf
SET "config" = jsonb_build_object(
  'options',
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('value', o.value, 'label', o.label) ORDER BY o.ord), '[]'::jsonb)
    FROM (
      SELECT DISTINCT ON (v.value) v.value, v.label, v.ord
      FROM (
        SELECT
          COALESCE(NULLIF(left(trim(both '_' from regexp_replace(lower(t.label), '[^a-z0-9]+', '_', 'g')), 40), ''), 'option_' || t.ord) AS value,
          left(t.label, 60) AS label,
          t.ord
        FROM unnest(cf."options") WITH ORDINALITY AS t(label, ord)
      ) v
      ORDER BY v.value, v.ord
    ) o
  )
)
WHERE cf."type" = 'select' AND cardinality(cf."options") > 0;

ALTER TABLE "CustomField" DROP COLUMN "options";

-- ---------------------------------------------------------------- Pipeline key / packKey / archivedAt
ALTER TABLE "Pipeline" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "key" TEXT,
ADD COLUMN "packKey" TEXT;

-- The oldest default pipeline of each workspace becomes "sales"; any other pipeline gets "pipeline_<n>".
WITH ranked AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "workspaceId" ORDER BY "isDefault" DESC, "createdAt", "id") AS rn,
         "isDefault"
  FROM "Pipeline"
)
UPDATE "Pipeline" p
SET "key" = CASE WHEN r.rn = 1 AND r."isDefault" THEN 'sales' ELSE 'pipeline_' || r.rn END
FROM ranked r
WHERE p."id" = r."id";

ALTER TABLE "Pipeline" ALTER COLUMN "key" SET NOT NULL;
UPDATE "Pipeline" SET "packKey" = 'generic-sales' WHERE "key" = 'sales';

-- ---------------------------------------------------------------- Role / Stage / Template
ALTER TABLE "Role" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "packKey" TEXT;

ALTER TABLE "Stage" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Template" ADD COLUMN "packKey" TEXT;
UPDATE "Template" SET "packKey" = 'generic-sales'
WHERE "channel" = 'whatsapp' AND "language" = 'en'
  AND "name" IN ('indiamart_welcome', 'price_list', 'product_catalog', 'indiamart_followup_1', 'missed_call_sorry', 'quote_reminder', 'revival_offer');

-- New permission resource records.* on the system roles (DEFAULT_ROLE_PERMISSIONS).
UPDATE "Role" r
SET "permissions" = r."permissions" || ARRAY(
  SELECT p FROM unnest(
    CASE r."kind"
      WHEN 'company_admin' THEN ARRAY['records.read', 'records.create', 'records.update', 'records.delete']
      WHEN 'viewer' THEN ARRAY['records.read']
      ELSE ARRAY['records.read', 'records.create', 'records.update']
    END
  ) AS p
  WHERE NOT (p = ANY (r."permissions"))
)
WHERE r."isSystem" = true;

UPDATE "PlatformAdmin"
SET "permissions" = array_append("permissions", 'platform.packs.manage')
WHERE 'platform.flags.manage' = ANY ("permissions") AND NOT ('platform.packs.manage' = ANY ("permissions"));

-- ---------------------------------------------------------------- new tables
CREATE TABLE "CustomObject" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "labelSingular" TEXT NOT NULL,
    "labelPlural" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Box',
    "description" TEXT,
    "primaryFieldKey" TEXT NOT NULL,
    "showInNav" BOOLEAN NOT NULL DEFAULT true,
    "packKey" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomRecord" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "values" JSONB NOT NULL DEFAULT '{}',
    "ownerId" UUID,
    "createdById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspacePack" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "packKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_installed',
    "installedVersion" TEXT,
    "modes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platformOverride" TEXT,
    "overrideReason" TEXT,
    "lastError" TEXT,
    "installedAt" TIMESTAMP(3),
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspacePack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackInstallLog" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "packKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromVersion" TEXT,
    "toVersion" TEXT,
    "modes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "conflicts" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'user',
    "actorId" UUID,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackInstallLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackDefinition" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "core" BOOLEAN NOT NULL DEFAULT false,
    "latestVersion" TEXT NOT NULL,
    "priceInrMonthly" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackVersion" (
    "id" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackPlanEntitlement" (
    "id" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "plan" "Plan" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackPlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------- indexes
CREATE UNIQUE INDEX "CustomObject_workspaceId_key_key" ON "CustomObject"("workspaceId", "key");
CREATE INDEX "CustomRecord_workspaceId_objectId_createdAt_idx" ON "CustomRecord"("workspaceId", "objectId", "createdAt");
CREATE INDEX "CustomRecord_workspaceId_objectId_ownerId_idx" ON "CustomRecord"("workspaceId", "objectId", "ownerId");
CREATE INDEX "CustomRecord_values_idx" ON "CustomRecord" USING GIN ("values" jsonb_path_ops);
CREATE INDEX "CustomRecord_title_trgm_idx" ON "CustomRecord" USING GIN ("title" gin_trgm_ops);
CREATE UNIQUE INDEX "WorkspacePack_workspaceId_packKey_key" ON "WorkspacePack"("workspaceId", "packKey");
CREATE INDEX "PackInstallLog_workspaceId_packKey_createdAt_idx" ON "PackInstallLog"("workspaceId", "packKey", "createdAt");
CREATE UNIQUE INDEX "PackDefinition_key_key" ON "PackDefinition"("key");
CREATE UNIQUE INDEX "PackVersion_packId_version_key" ON "PackVersion"("packId", "version");
CREATE UNIQUE INDEX "PackPlanEntitlement_packId_plan_key" ON "PackPlanEntitlement"("packId", "plan");
CREATE INDEX "CustomField_workspaceId_target_order_idx" ON "CustomField"("workspaceId", "target", "order");
CREATE UNIQUE INDEX "Pipeline_workspaceId_key_key" ON "Pipeline"("workspaceId", "key");

-- ---------------------------------------------------------------- foreign keys
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_customObjectId_fkey" FOREIGN KEY ("customObjectId") REFERENCES "CustomObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomObject" ADD CONSTRAINT "CustomObject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomRecord" ADD CONSTRAINT "CustomRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomRecord" ADD CONSTRAINT "CustomRecord_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "CustomObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomRecord" ADD CONSTRAINT "CustomRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspacePack" ADD CONSTRAINT "WorkspacePack_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackInstallLog" ADD CONSTRAINT "PackInstallLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackVersion" ADD CONSTRAINT "PackVersion_packId_fkey" FOREIGN KEY ("packId") REFERENCES "PackDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackPlanEntitlement" ADD CONSTRAINT "PackPlanEntitlement_packId_fkey" FOREIGN KEY ("packId") REFERENCES "PackDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
