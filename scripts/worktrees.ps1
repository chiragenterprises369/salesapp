# Orchestrator helper: create agent worktrees from main with deps, shared build and a scrubbed .env.
# Each stream gets its own ports and its own Postgres database (D-055): created, migrated and seeded
# on first use inside the shared docker container. Existing worktrees only get a refreshed .env.
# Usage: pwsh scripts/worktrees.ps1 -Streams backend-core,frontend-app [-NoDb]
param([string[]]$Streams, [switch]$NoDb)
# Native tools (git, pnpm) write progress to stderr; do not treat that as a terminating error.
$ErrorActionPreference = 'Continue'
$Streams = @($Streams | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$root = Split-Path -Parent $PSScriptRoot
$pgContainer = 'vistar-postgres-1'

$ports = @{
  'backend-core'             = @{ API_PORT = '4001'; DB = 'vistar_backend' }
  'backend-core-crm'         = @{ API_PORT = '4002'; DEV_AUTH = '1'; DB = 'vistar_backend_crm' }
  'frontend-app'             = @{ WEB_PORT = '3001'; API_PORT = '4011'; DB = 'vistar_shell' }
  'frontend-app-leads'       = @{ WEB_PORT = '3002'; API_PORT = '4012'; NEXT_PUBLIC_MOCK_PERSONA = 'manager'; DB = 'vistar_leads' }
  'frontend-physics'         = @{ WEB_PORT = '3003'; API_PORT = '4013'; NEXT_PUBLIC_MOCK_PERSONA = 'manager'; DB = 'vistar_physics' }
  'frontend-physics-builder' = @{ WEB_PORT = '3004'; API_PORT = '4014'; NEXT_PUBLIC_MOCK_PERSONA = 'manager'; DB = 'vistar_builder' }
  'frontend-3d'              = @{ WEB_PORT = '3005'; API_PORT = '4015'; NEXT_PUBLIC_MOCK_PERSONA = 'manager'; DB = 'vistar_floor' }
}

function Test-Db([string]$name) {
  $out = docker exec $pgContainer psql -U vistar -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$name'" 2>$null
  return ($out -match '1')
}

foreach ($s in $Streams) {
  $wt = Join-Path $root ".worktrees/$s"
  if (-not (Test-Path $wt)) {
    git -C $root worktree add $wt -b "agent/$s" main | Out-Null
  }
  $cfg = $ports[$s]
  # .env without asset-generation or storage secrets (agents do not need them); per-stream overrides appended.
  $envLines = Get-Content (Join-Path $root '.env') | Where-Object { $_ -notmatch '^FIZZLY_' -and $_ -notmatch '^(BUNNY_)?S3_(ACCESS_KEY|SECRET_KEY)=' }
  if ($cfg) {
    foreach ($k in $cfg.Keys) {
      if ($k -eq 'DB') { continue }
      $envLines = $envLines | Where-Object { $_ -notmatch "^$k=" }
      $envLines += "$k=$($cfg[$k])"
    }
    if ($cfg.DB) {
      # Same server and credentials as main, different database name.
      $envLines = $envLines | ForEach-Object { if ($_ -match '^DATABASE_URL=') { $_ -replace '/vistar(\?|$)', "/$($cfg.DB)`$1" } else { $_ } }
    }
  }
  [IO.File]::WriteAllLines((Join-Path $wt '.env'), [string[]]$envLines, (New-Object Text.UTF8Encoding($false)))
  Push-Location $wt
  pnpm install --frozen-lockfile --prefer-offline 2>&1 | Select-Object -Last 1
  pnpm --filter @vistar/shared build 2>&1 | Out-Null
  if ($cfg.DB -and -not $NoDb) {
    $fresh = -not (Test-Db $cfg.DB)
    if ($fresh) { docker exec $pgContainer createdb -U vistar $cfg.DB | Out-Null }
    Push-Location apps/api
    # Regenerate the client: --frozen-lockfile installs skip postinstall when nothing changed.
    npx prisma generate 2>&1 | Out-Null
    npx prisma migrate deploy 2>&1 | Select-String -Pattern 'applied|No pending|Error' | ForEach-Object { "  migrate: $($_.Line.Trim())" }
    Pop-Location
    if ($fresh) { pnpm --filter @vistar/api seed 2>&1 | Select-String -Pattern '^Seeded|Error' | ForEach-Object { "  seed: $($_.Line.Trim())" } }
  }
  Pop-Location
  Write-Output "ready: $s -> $wt (db $($cfg.DB))"
}
