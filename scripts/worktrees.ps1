# Orchestrator helper: create agent worktrees from main with deps, shared build and a scrubbed .env.
# Usage: pwsh scripts/worktrees.ps1 -Streams backend-core,frontend-app
param([string[]]$Streams)
# Native tools (git, pnpm) write progress to stderr; do not treat that as a terminating error.
$ErrorActionPreference = 'Continue'
$Streams = @($Streams | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$root = Split-Path -Parent $PSScriptRoot

$ports = @{
  'backend-core'             = @{ API_PORT = '4001' }
  'backend-core-crm'         = @{ API_PORT = '4002'; DEV_AUTH = '1' }
  'frontend-app'             = @{ WEB_PORT = '3001' }
  'frontend-app-leads'       = @{ WEB_PORT = '3002'; NEXT_PUBLIC_MOCK_PERSONA = 'manager' }
  'frontend-physics'         = @{ WEB_PORT = '3003'; NEXT_PUBLIC_MOCK_PERSONA = 'manager' }
  'frontend-physics-builder' = @{ WEB_PORT = '3004'; NEXT_PUBLIC_MOCK_PERSONA = 'manager' }
  'frontend-3d'              = @{ WEB_PORT = '3005'; NEXT_PUBLIC_MOCK_PERSONA = 'manager' }
}

foreach ($s in $Streams) {
  $wt = Join-Path $root ".worktrees/$s"
  if (-not (Test-Path $wt)) {
    git -C $root worktree add $wt -b "agent/$s" main | Out-Null
  }
  # .env without asset-generation or storage secrets (agents do not need them); per-stream overrides appended.
  $envLines = Get-Content (Join-Path $root '.env') | Where-Object { $_ -notmatch '^FIZZLY_' -and $_ -notmatch '^(BUNNY_)?S3_(ACCESS_KEY|SECRET_KEY)=' }
  $extra = $ports[$s]
  if ($extra) {
    foreach ($k in $extra.Keys) {
      $envLines = $envLines | Where-Object { $_ -notmatch "^$k=" }
      $envLines += "$k=$($extra[$k])"
    }
  }
  [IO.File]::WriteAllLines((Join-Path $wt '.env'), [string[]]$envLines, (New-Object Text.UTF8Encoding($false)))
  Push-Location $wt
  pnpm install --frozen-lockfile --prefer-offline 2>&1 | Select-Object -Last 1
  pnpm --filter @vistar/shared build 2>&1 | Out-Null
  Pop-Location
  Write-Output "ready: $s -> $wt"
}
