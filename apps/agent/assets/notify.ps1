param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Body
)
$xml = @"
<toast><visual><binding template="ToastGeneric"><text>$Title</text><text>$Body</text></binding></visual></toast>
"@
$shown = $false
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($xml)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($document)
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
  $shown = $true
} catch {
  $shown = $false
}
if (-not $shown) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = [System.Drawing.SystemIcons]::Information
  $notify.Visible = $true
  $notify.ShowBalloonTip(8000, $Title, $Body, [System.Windows.Forms.ToolTipIcon]::Info)
}
Start-Sleep -Seconds 8
