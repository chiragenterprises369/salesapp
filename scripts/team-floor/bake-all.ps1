# Rebuilds every Team Floor office GLB and its Day, Evening and AO bakes, one template after the
# other (each run uses all CPU cores). Logs go to scripts/team-floor/.out/logs/bake-<id>.log.
# Usage (repo root): powershell -File scripts/team-floor/bake-all.ps1 [-Templates small,medium,large]
param(
  [string[]]$Templates = @('small', 'medium', 'large'),
  [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
)
$ErrorActionPreference = 'Stop'
$Templates = @($Templates | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repo
New-Item -ItemType Directory -Force 'scripts/team-floor/.out/logs' | Out-Null
node scripts/team-floor/templates/build-templates.mjs
if ($LASTEXITCODE -ne 0) { throw 'Template validation failed' }

# Lightmap size and samples per template (Large covers ~3x the floor area of Medium).
$settings = @{
  small  = @{ size = 2048; samples = 128 }
  medium = @{ size = 2048; samples = 128 }
  large  = @{ size = 3072; samples = 96 }
}
foreach ($t in $Templates) {
  $s = $settings[$t]
  $log = "scripts/team-floor/.out/logs/bake-$t.log"
  $start = Get-Date
  # cmd redirection: Blender writes warnings to stderr, which Windows PowerShell would turn into errors.
  $cmd = "`"$Blender`" --background --factory-startup --python scripts/team-floor/blender/build_office.py -- --template $t --bake --samples $($s.samples) --size $($s.size) --export > `"$log`" 2>&1"
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { throw "Blender failed for $t (see $log)" }
  '{0}: {1:n0} s' -f $t, ((Get-Date) - $start).TotalSeconds
}
