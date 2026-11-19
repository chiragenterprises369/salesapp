# Live demo for the client presentation (Shakti Industries). Development only; never run against production.
# Keeps the Shakti team online on the Team Floor (heartbeats every 15 s), rotates some statuses (meeting, lunch,
# field visit, break), and as anil@ adds a new IndiaMART/website lead or moves a lead on the board every ~40 s.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo-live.ps1   (API on http://localhost:4000, demo data loaded)
# Stop: Stop-Process -Id (Get-Content "$env:TEMP\vistar-run\demo-live.pid")
$ErrorActionPreference = 'Continue'
$api = 'http://localhost:4000/api/v1'
$pw = 'vistar-demo-123'
$log = "$env:TEMP\vistar-run\demo-live.log"
New-Item -ItemType Directory -Force "$env:TEMP\vistar-run" | Out-Null
$PID | Set-Content "$env:TEMP\vistar-run\demo-live.pid"
function Say($m) { "$(Get-Date -Format HH:mm:ss) $m" | Add-Content $log }

$team = 'priya', 'gurpreet', 'rohit', 'kavita', 'farah', 'lakshmi', 'sneha', 'mohit', 'karthik', 'imran' | ForEach-Object { "$_@shakti.example" }
$sessions = [ordered]@{}

function Login([string]$email) {
  try {
    $r = Invoke-RestMethod -Uri "$api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = $email; password = $pw } | ConvertTo-Json) -TimeoutSec 15
    $ttl = 780; if ($r.expiresIn -as [int]) { $ttl = [int]$r.expiresIn - 120 }
    return @{ token = $r.accessToken; exp = (Get-Date).AddSeconds($ttl) }
  } catch { Say "login failed $email $($_.Exception.Message)"; return $null }
}
function Call([hashtable]$s, [string]$method, [string]$path, $body) {
  $req = @{ Uri = "$api$path"; Method = $method; Headers = @{ Authorization = "Bearer $($s.token)" }; TimeoutSec = 15 }
  if ($null -ne $body) { $req.ContentType = 'application/json'; $req.Body = ($body | ConvertTo-Json -Depth 5) }
  try { return Invoke-RestMethod @req } catch { Say "$method $path failed: $($_.ErrorDetails.Message)"; return $null }
}

$screens = 'leads', 'board', 'lead_detail', 'inbox', 'conversation', 'calls', 'tasks', 'home'
$away = @(
  @{ status = 'in_meeting'; note = 'Client meeting, conference room' },
  @{ status = 'field_visit'; note = 'Site visit, Andheri MIDC' },
  @{ status = 'lunch'; note = $null },
  @{ status = 'on_break'; note = $null },
  @{ status = 'field_visit'; note = 'Dealer visit, Bhiwandi' },
  @{ status = 'in_meeting'; note = 'Review with Priya' }
)
function Beat([hashtable]$s) {
  $activity = if ((Get-Random -Maximum 10) -lt 8) { 'active' } else { 'idle' }
  $null = Call $s 'Post' '/me/presence/heartbeat' @{ client = 'web'; activity = $activity; screen = ($screens | Get-Random) }
}

# admin session for board activity (no heartbeat: the presenter uses this account in the browser)
$admin = Login 'anil@shakti.example'
Start-Sleep -Seconds 7
$pipe = (Call $admin 'Get' '/pipelines' $null).items | Where-Object { $_.isDefault -and $_.entity -eq 'lead' } | Select-Object -First 1
$stages = @($pipe.stages)
$openStages = @($stages | Where-Object { $_.key -notin 'won', 'lost' -and $_.type -notin 'won', 'lost' })
$wonStage = $stages | Where-Object { $_.key -eq 'won' -or $_.type -eq 'won' } | Select-Object -First 1
Say "pipeline $($pipe.name): $($stages.Count) stages"

# bring the team online one by one (login rate limit: about 8 a minute)
foreach ($e in $team) {
  $s = Login $e
  if ($s) { $sessions[$e] = $s; Beat $s; Say "online $e" }
  Start-Sleep -Seconds 7
}
# a few people start away from their desk
$sessions.Keys | Get-Random -Count 3 | ForEach-Object { $a = $away | Get-Random; $null = Call $sessions[$_] 'Put' '/me/status' (@{ status = $a.status } + $(if ($a.note) { @{ note = $a.note } } else { @{} })); Say "$_ -> $($a.status)" }

$first = 'Rajesh', 'Suresh', 'Amit', 'Neha', 'Pooja', 'Vikram', 'Sanjay', 'Kiran', 'Deepak', 'Anjali', 'Manoj', 'Ritu', 'Harish', 'Meena', 'Arvind', 'Swati'
$last = 'Patel', 'Shah', 'Mehta', 'Gupta', 'Agarwal', 'Jain', 'Reddy', 'Nair', 'Iyer', 'Kulkarni', 'Deshmukh', 'Singh', 'Verma', 'Chopra'
$firms = 'Traders', 'Enterprises', 'Industries', 'Engineering Works', 'Fabricators', 'Infra Projects', 'Steel House', 'Hardware Mart'
$cities = @(@('Pune', 'Maharashtra'), @('Ahmedabad', 'Gujarat'), @('Surat', 'Gujarat'), @('Nashik', 'Maharashtra'), @('Indore', 'Madhya Pradesh'), @('Jaipur', 'Rajasthan'), @('Coimbatore', 'Tamil Nadu'), @('Ludhiana', 'Punjab'), @('Hyderabad', 'Telangana'), @('Nagpur', 'Maharashtra'))
$products = @('SS pipe 2 inch, 500 m', 'MS angle 50x50, 3 tonnes', 'GI sheets 0.5 mm, 200 pcs', 'SS 304 sheets, 1 tonne', 'MS channel 100 mm, 2 tonnes', 'SS round bar 25 mm, 800 kg', 'GI pipe 1.5 inch, 300 m')

$tick = 0
while ($true) {
  $tick++
  foreach ($e in @($sessions.Keys)) {
    if ((Get-Date) -gt $sessions[$e].exp) { $s = Login $e; if ($s) { $sessions[$e] = $s }; Start-Sleep -Seconds 2 }
    Beat $sessions[$e]
  }
  if ((Get-Date) -gt $admin.exp) { $n = Login 'anil@shakti.example'; if ($n) { $admin = $n } }

  # every minute: one person goes away, one comes back
  if ($tick % 4 -eq 0 -and $sessions.Count) {
    $e = $sessions.Keys | Get-Random; $a = $away | Get-Random
    $null = Call $sessions[$e] 'Put' '/me/status' (@{ status = $a.status } + $(if ($a.note) { @{ note = $a.note } } else { @{} })); Say "$e -> $($a.status)"
    $b = $sessions.Keys | Get-Random
    $null = Call $sessions[$b] 'Put' '/me/status' @{ status = 'available' }; Say "$b -> available"
  }

  # every ~45 s: a new lead, or a lead moves forward (sometimes to Won)
  if ($tick % 3 -eq 0 -and $openStages.Count) {
    if ((Get-Random -Maximum 2) -eq 0) {
      $c = $cities | Get-Random; $n = "$($first | Get-Random) $($last | Get-Random)"
      $lead = @{ name = $n; companyName = "$(($last | Get-Random)) $($firms | Get-Random)"; phone = "+919$(Get-Random -Minimum 100000000 -Maximum 999999999)"; city = $c[0]; state = $c[1]; source = ('indiamart', 'website', 'whatsapp' | Get-Random); productInterest = ($products | Get-Random); valueInr = (Get-Random -Minimum 45 -Maximum 900) * 1000 }
      $r = Call $admin 'Post' '/leads' $lead; if ($r) { Say "new lead $n ($($lead.source))" }
    } else {
      $list = Call $admin 'Get' "/leads?limit=40" $null
      $cands = @($list.items | Where-Object { $openStages.id -contains $_.stageId })
      if ($cands.Count) {
        $l = $cands | Get-Random
        $idx = [array]::IndexOf(@($openStages.id), $l.stageId)
        $target = if ($wonStage -and (Get-Random -Maximum 5) -eq 0) { $wonStage } elseif ($idx -lt $openStages.Count - 1) { $openStages[$idx + 1] } else { $openStages[0] }
        $r = Call $admin 'Post' "/leads/$($l.id)/move" @{ stageId = $target.id }; if ($r) { Say "moved $($l.name) -> $($target.name)" }
      }
    }
  }
  Start-Sleep -Seconds 15
}
