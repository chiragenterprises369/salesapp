---
name: vistar-industry-packs
description: Vistar Industry Packs and flexible data layer - custom objects, custom fields on core entities, field types/validation/permissions, configurable labels and stages, pack manifests (install/upgrade/uninstall), registry and UI extension points. Use for any work on customization, packs or pack-provided screens.
---

# Vistar Industry Packs

Contracts: `packages/shared/src/customization/*` (fields, objects, labels, values), `packages/shared/src/packs/*`
(manifest schema, install planner), `packs/<key>/manifest.json`, Prisma models `CustomObject`, `CustomField`,
`CustomRecord`, `WorkspacePack`, `PackInstallLog` (tenant) and `PackDefinition`, `PackVersion`,
`PackPlanEntitlement` (platform). Spec: `docs/SPEC.md` section 22.

## Principles
- The core CRM is identical for every business. Packs only ADD data definitions and screens; they never fork or patch core code.
- Everything a pack adds is data in the database: objects, fields, labels, stages, roles, templates. No pack-specific `if` statements in core modules.
- Install is a pure plan (`planPackInstall`) executed in one transaction. Running it twice changes nothing.
- Uninstall archives (`archivedAt`) what the pack created and keeps all user data (records, field values, leads in pack pipelines). Reinstall unarchives.
- Every pack-created row carries `packKey`; items are matched by stable keys (object key, `target`+field key, pipeline key, stage key, role key, template name).
- `generic-sales` is the core pack: installed in every workspace, upgradeable, never uninstallable.

## Data layer rules
- Core entities with custom fields: `CORE_ENTITIES` (lead, contact, company, deal, task, call). Values live in the entity's `customFields` JSON. Custom object records live in `CustomRecord.values`.
- Field target = a core entity or `object:<key>`. Field keys are snake_case and never reused after archive.
- Validate every write with `validateCustomValues(defs, values, { mode, roleKey })`. It rejects unknown keys, archived fields, wrong types, missing required fields (on create), and writes to read-only fields. Never trust client-side validation.
- Reads go through `visibleValues(defs, values, roleKey)`, which strips fields hidden for the caller's role. Field permissions use role keys (`Role.key`), so custom roles work.
- Money is whole rupees. Geo-points are `{ lat, lng }`. Relation, user and file values are ids (one id, or an array when `multiple`).
- Labels: read via `resolveLabels(stored)` and `labelOf(labels, 'lead', { plural })`. Only display text changes; URLs, API paths, event names and DB names keep the core names.
- Tenant client for all tenant tables; platform pack tables only through the root client (registry, entitlements).

## Manifest rules
- `PackManifestSchema` (schemaVersion 1); `version` is semver. Breaking changes need a new major version and an explicit upgrade note.
- Items may declare `modes` (e.g. developer / broker). They apply only when that mode is enabled at activation.
- Code-backed items (`navigation`, `dashboardWidgets`, `reports`) reference a `component` id resolved by the web pack UI registry (`apps/web/lib/packs`). A missing component renders a neutral "Not available yet" state and never crashes.
- Workflow templates in a manifest must pass `validateGraph`. WhatsApp templates install as `draft` suggestions; they become sendable only after provider approval.
- Roles in a manifest use the four kinds (company_admin, manager, employee, viewer) and permissions from `PERMISSION_MATRIX`.

## Web extension points (`apps/web/lib/packs`)
- `usePackRuntime()` returns active packs, labels, nav items, widgets, reports and import mappings.
- Navigation: `withPackNavigation(NAV_COMPANY, items)`. Pack pages live at `/app/x/<packKey>/<page>` and render `<PackPage>`.
- Dashboards: `<WidgetSlot slot="dashboard.main" />`. Pack UI modules register lazily in `lib/packs/ui-index.ts`; adding a pack is one line there.

## Tests that must stay green
- Planner: install into empty, reinstall = 0 ops, upgrade only applies the diff, uninstall archives only, mode filtering.
- Values: every field type, required, unknown keys, hidden and read-only per role.
- API: install / upgrade / uninstall against a temp workspace, existing workspaces migrated (generic-sales active, pipeline keys unique), custom record tenant isolation.
