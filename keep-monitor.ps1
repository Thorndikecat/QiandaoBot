$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $Root 'keep-monitor.js') @args
exit $LASTEXITCODE
