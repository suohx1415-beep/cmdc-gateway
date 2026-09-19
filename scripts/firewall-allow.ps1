# Adds an inbound firewall rule for the cmdc gateway port.
# Scope: local subnet only, so the LAN can reach it but the internet cannot.
# Run elevated (the launcher triggers UAC).

$ErrorActionPreference = 'Stop'
$port = 8810
$name = "cmdc-gateway TCP $port (LocalSubnet)"

try {
  $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "[清理] 删除已有规则: $name"
    $existing | Remove-NetFirewallRule
  }

  New-NetFirewallRule `
    -DisplayName $name `
    -Description "cmdc gateway (OpenAI/Anthropic compatible local gateway) on port $port" `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $port `
    -Profile Any `
    -RemoteAddress LocalSubnet `
    -Enabled True | Out-Null

  Write-Host ""
  Write-Host "[完成] 已放行 TCP $port，仅限本地子网 (LocalSubnet)" -ForegroundColor Green
  Write-Host ""
  Get-NetFirewallRule -DisplayName $name |
    Select-Object DisplayName, Direction, Action, Enabled, Profile |
    Format-Table -AutoSize | Out-String -Width 200 | Write-Host
  Write-Host "注意：防火墙本身没有被关闭。想撤销就删掉这条规则：" -ForegroundColor Yellow
  Write-Host "      Remove-NetFirewallRule -DisplayName `"$name`""
} catch {
  Write-Host ""
  Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
}
