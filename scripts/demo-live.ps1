# Live demo: makes the Team Floor and the Leads board of a demo company look like a busy real office.
# Development and demo data only; never run it against real customer data.
#
# Every person of the team gets their own day: working at the desk (heartbeats with the screen and lead they have
# open), phone calls (walks to the calling booth; the call is logged), breaks and lunch (walks to the lounge),
# meetings and field visits. The admin account gets new IndiaMART, website and WhatsApp leads, and leads move along
# the pipeline (sometimes to Won, which plays the celebration on the board).
#
# Run (local API):  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo-live.ps1
# Run (live API):   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo-live.ps1 -Api https://salesapp-api-lqk9.onrender.com/api/v1
# Stop:             Stop-Process -Id (Get-Content "$env:TEMP\vistar-run\demo-live-<host>.pid")
# Log:              %TEMP%\vistar-run\demo-live-<host>.log
param(
  [string]$Api = 'http://localhost:4000/api/v1',
  [ValidateSet('shakti', 'navkar', 'sunrise')][string]$Company = 'shakti',
  [string]$Password = 'vistar-demo-123'
)
$ErrorActionPreference = 'Continue'
$hostName = ([uri]$Api).Host
$dir = "$env:TEMP\vistar-run"
New-Item -ItemType Directory -Force $dir | Out-Null
$log = "$dir\demo-live-$hostName.log"
$PID | Set-Content "$dir\demo-live-$hostName.pid"
function Say($m) { "$(Get-Date -Format HH:mm:ss) $m" | Add-Content $log }

$companies = @{
  shakti  = @{ admin = 'anil'; team = 'priya', 'gurpreet', 'rohit', 'kavita', 'farah', 'lakshmi', 'sneha', 'mohit', 'karthik', 'imran' }
  navkar  = @{ admin = 'jignesh'; team = 'hetal', 'bhavin', 'komal', 'ravi' }
  sunrise = @{ admin = 'senthil'; team = 'revathi', 'arun', 'divya' }
}
$domain = "$Company.example"
$adminEmail = "$($companies[$Company].admin)@$domain"
$team = $companies[$Company].team | ForEach-Object { "$_@$domain" }

function Login([string]$email) {
  try {
    $r = Invoke-RestMethod -Uri "$Api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = $email; password = $Password } | ConvertTo-Json) -TimeoutSec 60
    $ttl = 780; if ($r.expiresIn -as [int]) { $ttl = [int]$r.expiresIn - 120 }
    return @{ token = $r.accessToken; exp = (Get-Date).AddSeconds($ttl); userId = $r.me.user.id }
  } catch { Say "login failed $email $($_.Exception.Message)"; return $null }
}
function Call([hashtable]$s, [string]$method, [string]$path, $body) {
  $req = @{ Uri = "$Api$path"; Method = $method; Headers = @{ Authorization = "Bearer $($s.token)" }; TimeoutSec = 30 }
  if ($null -ne $body) { $req.ContentType = 'application/json'; $req.Body = ($body | ConvertTo-Json -Depth 5) }
  try { return Invoke-RestMethod @req } catch { Say "$method $path failed: $($_.ErrorDetails.Message)"; return $null }
}
function Rand([int]$min, [int]$max) { Get-Random -Minimum $min -Maximum ($max + 1) }

$workScreens = 'leads', 'board', 'lead_detail', 'lead_detail', 'inbox', 'conversation', 'tasks', 'calls', 'home', 'reports'
$breaks = @(
  @{ status = 'on_break'; note = 'Chai break' },
  @{ status = 'lunch'; note = $null },
  @{ status = 'away'; note = 'Back in 10 min' },
  @{ status = 'on_break'; note = $null }
)
$meetings = @(
  @{ status = 'in_meeting'; note = 'Client meeting, conference room' },
  @{ status = 'in_meeting'; note = 'Weekly sales review' },
  @{ status = 'field_visit'; note = 'Site visit, Andheri MIDC' },
  @{ status = 'field_visit'; note = 'Dealer visit, Bhiwandi' },
  @{ status = 'in_meeting'; note = 'Quotation discussion with buyer' }
)

function SetStatus($p, $s) {
  $body = @{ status = $s.status }
  if ($s.note) { $body.note = $s.note }
  $null = Call $p.session 'Put' '/me/status' $body
  Say "$($p.email) -> $($s.status)$(if ($s.note) { " ($($s.note))" })"
}
function Beat($p) {
  $activity = 'active'; if ((Rand 1 10) -gt 8) { $activity = 'idle' }
  $body = @{ client = 'web'; activity = $activity; screen = ($workScreens | Get-Random) }
  if ($p.leads.Count -and $body.screen -in 'lead_detail', 'board', 'leads') { $body.currentLeadId = ($p.leads | Get-Random).id }
  $null = Call $p.session 'Post' '/me/presence/heartbeat' $body
  $p.nextBeat = (Get-Date).AddSeconds(15)
}
function StartCall($p) {
  $lead = $null; if ($p.leads.Count) { $lead = $p.leads | Get-Random }
  $phone = "+919$(Rand 100000000 999999999)"; if ($lead -and $lead.phone) { $phone = $lead.phone }
  $p.callId = "demo-$([guid]::NewGuid().ToString('N'))"
  $body = @{ event = 'started'; clientCallId = $p.callId; direction = ('outbound', 'outbound', 'outbound', 'inbound' | Get-Random); phone = $phone; startedAt = (Get-Date).ToUniversalTime().ToString('o') }
  if ($lead) { $body.leadId = $lead.id }
  $r = Call $p.session 'Post' '/me/calls/active' $body
  if ($r) { Say "$($p.email) calling $(if ($lead) { $lead.name } else { $phone })" } else { $p.callId = $null }
}
function EndCall($p) {
  if ($p.callId) { $null = Call $p.session 'Post' '/me/calls/active' @{ event = 'ended'; clientCallId = $p.callId; endedAt = (Get-Date).ToUniversalTime().ToString('o') }; Say "$($p.email) call ended" }
  $p.callId = $null
}
# Back at the desk people clear their overdue follow-ups (sometimes one stays, as in a real office).
function DoTasks($p) {
  $od = Call $p.session 'Get' '/tasks?scope=mine&due=overdue&limit=10' $null
  $items = @($od.items)
  if (-not $items.Count) { return }
  $keep = 0; if ($items.Count -gt 1 -and (Rand 1 10) -le 3) { $keep = 1 }
  Say "$($p.email) clears $($items.Count - $keep) overdue task(s)"
  foreach ($t in ($items | Select-Object -Skip $keep)) {
    $r = Call $p.session 'Patch' "/tasks/$($t.id)" @{ status = 'done' }
    if ($r) { Say "$($p.email) done: $($t.title)" }
  }
}

# ---------------------------------------------------------------- start
Say "demo for $Company on $Api"
$admin = Login $adminEmail
if (-not $admin) { Say 'admin login failed, stopping'; exit 1 }
$pipe = (Call $admin 'Get' '/pipelines' $null).items | Where-Object { $_.isDefault -and $_.entity -eq 'lead' } | Select-Object -First 1
$stages = @($pipe.stages)
$openStages = @($stages | Where-Object { $_.key -notin 'won', 'lost' -and $_.type -notin 'won', 'lost' })
$wonStage = $stages | Where-Object { $_.key -eq 'won' -or $_.type -eq 'won' } | Select-Object -First 1
Say "pipeline $($pipe.name): $($stages.Count) stages"

$people = New-Object System.Collections.ArrayList
foreach ($e in $team) {
  Start-Sleep -Seconds 7 # login rate limit: about 8 a minute per IP
  $s = Login $e
  if (-not $s) { continue }
  $p = @{ email = $e; session = $s; state = 'desk'; until = (Get-Date).AddSeconds((Rand 10 60)); callId = $null; leads = @(); nextBeat = Get-Date }
  $mine = Call $s 'Get' '/leads?limit=30' $null
  if ($mine) { $p.leads = @($mine.items | Where-Object { $_.phone } | Select-Object id, name, phone) }
  $null = Call $s 'Put' '/me/status' @{ status = 'available' }
  Beat $p
  [void]$people.Add($p)
  Say "online $e ($($p.leads.Count) leads)"
}

$first = 'Rajesh', 'Suresh', 'Amit', 'Neha', 'Pooja', 'Vikram', 'Sanjay', 'Kiran', 'Deepak', 'Anjali', 'Manoj', 'Ritu', 'Harish', 'Meena', 'Arvind', 'Swati', 'Nitin', 'Rekha'
$last = 'Patel', 'Shah', 'Mehta', 'Gupta', 'Agarwal', 'Jain', 'Reddy', 'Nair', 'Iyer', 'Kulkarni', 'Deshmukh', 'Singh', 'Verma', 'Chopra'
$firms = 'Traders', 'Enterprises', 'Industries', 'Engineering Works', 'Fabricators', 'Infra Projects', 'Steel House', 'Hardware Mart'
$cities = @(@('Pune', 'Maharashtra'), @('Ahmedabad', 'Gujarat'), @('Surat', 'Gujarat'), @('Nashik', 'Maharashtra'), @('Indore', 'Madhya Pradesh'), @('Jaipur', 'Rajasthan'), @('Coimbatore', 'Tamil Nadu'), @('Ludhiana', 'Punjab'), @('Hyderabad', 'Telangana'), @('Nagpur', 'Maharashtra'))
$products = @('SS pipe 2 inch, 500 m', 'MS angle 50x50, 3 tonnes', 'GI sheets 0.5 mm, 200 pcs', 'SS 304 sheets, 1 tonne', 'MS channel 100 mm, 2 tonnes', 'SS round bar 25 mm, 800 kg', 'GI pipe 1.5 inch, 300 m')
$nextBoard = (Get-Date).AddSeconds(20)
$nextAssign = (Get-Date).AddSeconds(30)

# ---------------------------------------------------------------- the office day
while ($true) {
  $now = Get-Date
  $onBreak = @($people | Where-Object { $_.state -eq 'break' }).Count
  $onCall = @($people | Where-Object { $_.state -eq 'call' }).Count
  foreach ($p in $people) {
    if ($now -gt $p.session.exp) { $n = Login $p.email; if ($n) { $p.session = $n } }
    if ($now -ge $p.until) {
      switch ($p.state) {
        'call' { EndCall $p; $p.state = 'desk'; $p.until = $now.AddSeconds((Rand 20 70)); if ((Rand 1 2) -eq 1) { DoTasks $p } }
        { $_ -in 'break', 'meeting' } { $null = Call $p.session 'Put' '/me/status' @{ status = 'available' }; Say "$($p.email) back at desk"; $p.state = 'desk'; $p.until = $now.AddSeconds((Rand 30 80)); DoTasks $p }
        default {
          $roll = Rand 1 100
          if ($roll -le 45 -and $onCall -lt 4) { StartCall $p; if ($p.callId) { $p.state = 'call'; $onCall++; $p.until = $now.AddSeconds((Rand 40 150)) } else { $p.until = $now.AddSeconds(30) } }
          elseif ($roll -le 62 -and $onBreak -lt 3) { SetStatus $p ($breaks | Get-Random); $p.state = 'break'; $onBreak++; $p.until = $now.AddSeconds((Rand 60 180)) }
          elseif ($roll -le 72) { SetStatus $p ($meetings | Get-Random); $p.state = 'meeting'; $p.until = $now.AddSeconds((Rand 90 240)) }
          else { $p.until = $now.AddSeconds((Rand 30 90)) } # keeps working at the desk
        }
      }
    }
    if ($now -ge $p.nextBeat) { Beat $p }
  }

  # the manager hands out leads that waited more than 3 minutes (new ones still show as waiting for a while)
  if ($now -ge $nextAssign -and $people.Count) {
    $snap = Call $admin 'Get' '/team-floor/snapshot' $null
    foreach ($w in @($snap.leadsWaiting)) {
      if (((Get-Date).ToUniversalTime() - ([datetime]$w.createdAt).ToUniversalTime()).TotalMinutes -lt 3) { continue }
      $to = $people | Get-Random
      $r = Call $admin 'Patch' "/leads/$($w.leadId)" @{ ownerId = $to.session.userId }
      if ($r) { Say "assigned $($w.name) -> $($to.email)" }
    }
    $nextAssign = $now.AddSeconds(60)
  }

  # board activity as the admin: a new lead or a lead moving on (sometimes Won)
  if ($now -ge $nextBoard -and $openStages.Count) {
    if ($now -gt $admin.exp) { $n = Login $adminEmail; if ($n) { $admin = $n } }
    if ((Rand 1 2) -eq 1) {
      $c = $cities | Get-Random; $name = "$($first | Get-Random) $($last | Get-Random)"
      $lead = @{ name = $name; companyName = "$($last | Get-Random) $($firms | Get-Random)"; phone = "+919$(Rand 100000000 999999999)"; city = $c[0]; state = $c[1]; source = ('indiamart', 'indiamart', 'website', 'whatsapp' | Get-Random); productInterest = ($products | Get-Random); valueInr = (Rand 45 900) * 1000 }
      $r = Call $admin 'Post' '/leads' $lead; if ($r) { Say "new lead $name ($($lead.source))" }
    } else {
      $list = Call $admin 'Get' '/leads?limit=40' $null
      $cands = @($list.items | Where-Object { $openStages.id -contains $_.stageId })
      if ($cands.Count) {
        $l = $cands | Get-Random
        $idx = [array]::IndexOf(@($openStages.id), $l.stageId)
        $target = $openStages[0]
        if ($wonStage -and (Rand 1 4) -eq 1) { $target = $wonStage } elseif ($idx -lt $openStages.Count - 1) { $target = $openStages[$idx + 1] }
        $r = Call $admin 'Post' "/leads/$($l.id)/move" @{ stageId = $target.id }; if ($r) { Say "moved $($l.name) -> $($target.name)" }
      }
    }
    $nextBoard = $now.AddSeconds((Rand 25 45))
  }
  Start-Sleep -Seconds 4
}
