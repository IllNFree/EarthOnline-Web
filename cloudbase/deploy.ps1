# EarthOnline · 腾讯云 CloudBase 部署脚本（PowerShell）
# 说明：本脚本只作为可照抄的部署步骤，必须人工逐步确认；不会自动创建环境、不会自动部署。
# 前置：Node 18+ / npm 可用；已在仓库根目录执行 npm run build 生成 ..\dist。
# 所有命令基于 CloudBase CLI 3.9.1（tcb fn / tcb deploy / tcb hosting / tcb routes）。

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Confirm-Step([string]$title) {
  Write-Host ""
  Write-Host "== $title ==" -ForegroundColor Cyan
  $answer = Read-Host "执行这一步？(y/N)"
  if ($answer -notmatch '^(y|Y|yes|YES)$') {
    Write-Host "已跳过：$title" -ForegroundColor DarkYellow
    return $false
  }
  return $true
}

function Stop-WithHint([string]$message, [string]$hint) {
  Write-Host ""
  Write-Host "[失败] $message" -ForegroundColor Red
  Write-Host "[排查] $hint" -ForegroundColor Yellow
  exit 1
}

# ---------- 0. 前置检查 ----------
if (-not (Test-Path -LiteralPath '..\dist\index.html')) {
  Stop-WithHint '找不到 ..\dist\index.html' '先在 EarthOnline-Web 根目录执行 npm install && npm run build，再运行本脚本。'
}

$rcPath = Join-Path $PSScriptRoot 'cloudbaserc.json'
$rc = Get-Content -LiteralPath $rcPath -Raw | ConvertFrom-Json
$masterKey = $rc.functions[0].envVariables.EO_MASTER_KEY
if (-not $masterKey -or $masterKey -like '<*') {
  Stop-WithHint 'cloudbaserc.json 里的 EO_MASTER_KEY 还是占位值' '生成密钥后填入 functions[0].envVariables.EO_MASTER_KEY（可用 node -e "console.log(require(''crypto'').randomBytes(32).toString(''hex''))"），否则所有函数实例会共用开发密钥。'
}

# ---------- 1. 安装 CLI ----------
if (-not (Get-Command tcb -ErrorAction SilentlyContinue)) {
  if (Confirm-Step '安装 CloudBase CLI（npm i -g @cloudbase/cli）') {
    npm i -g @cloudbase/cli
    if ($LASTEXITCODE -ne 0) { Stop-WithHint 'npm 全局安装失败' '检查 npm 是否可用、网络/镜像是否正常，或用管理员终端重试。' }
    $env:Path = "$env:APPDATA\npm;$env:Path"
    if (-not (Get-Command tcb -ErrorAction SilentlyContinue)) {
      Stop-WithHint '安装后仍找不到 tcb 命令' '重开终端，或把 npm 全局 bin 目录（一般是 %APPDATA%\npm）加入 PATH。'
    }
  }
}

if (Confirm-Step '确认 CLI 版本（tcb --version）') {
  tcb --version
  if ($LASTEXITCODE -ne 0) { Stop-WithHint 'tcb 无法运行' '确认 Node 18+ 已安装且 tcb 在 PATH 中。' }
}

# ---------- 2. 登录 ----------
if (Confirm-Step '登录腾讯云（tcb login）') {
  tcb login
  if ($LASTEXITCODE -ne 0) { Stop-WithHint '登录失败' '按提示在浏览器完成授权；企业账号确认有该环境的权限。' }
}

# ---------- 3. 选择环境 ----------
if (Confirm-Step '列出环境（tcb env list）') {
  tcb env list
  if ($LASTEXITCODE -ne 0) { Stop-WithHint '无法列出环境' '确认已登录、账号已开通 CloudBase；必要时先在控制台创建环境。' }
}

$EnvId = Read-Host '请输入目标环境 ID（tcb env list 输出里的 EnvId）'
if (-not $EnvId) { Stop-WithHint '未提供环境 ID' '重新运行并输入形如 prod-xxxx 的环境 ID。' }

# ---------- 4. 部署云函数 api ----------
# cloudbaserc.json 的 functions[].runtime/timeout/memorySize/envVariables 会随本次部署一起下发。
if (Confirm-Step '预览部署计划（tcb deploy --dry-run）') {
  tcb deploy --dry-run -e $EnvId
  if ($LASTEXITCODE -ne 0) { Stop-WithHint 'dry-run 失败' '检查 cloudbaserc.json 的 $schema/version/envId 占位是否正确，以及环境 ID 是否有效。' }
}

if (Confirm-Step '部署云函数 api（tcb deploy --only functions）') {
  tcb deploy --only functions -e $EnvId
  if ($LASTEXITCODE -ne 0) { Stop-WithHint '云函数部署失败' '检查 functions/api/package.json 与依赖、Node 版本；也可在控制台查看构建日志。' }
}

# ---------- 5. 设置环境变量 ----------
# 环境变量来自 cloudbaserc.json 的 functions[0].envVariables，随上一步的部署下发；
# 修改 EO_MASTER_KEY / GITHUB_* 后，重新执行 tcb deploy --only functions 即可收敛。
if (Confirm-Step '确认环境变量已下发（tcb fn detail api --json）') {
  tcb fn detail api -e $EnvId --json
  if ($LASTEXITCODE -ne 0) { Stop-WithHint '读取函数详情失败' '确认函数 api 已创建；环境变量也可在控制台「云函数 → api → 函数配置」手动添加。' }
}

# ---------- 6. 部署静态托管 ----------
# cloudbaserc.json 的 hosting[0]：root=..、outputDir=dist，即上传 ../dist 到站点根路径。
if (Confirm-Step '部署静态托管（tcb deploy --only hosting）') {
  tcb deploy --only hosting -e $EnvId
  if ($LASTEXITCODE -ne 0) { Stop-WithHint '静态托管部署失败' '确认 ..\dist 已构建；如提示缺少静态托管应用，先按 CLI 提示创建或改用 tcb hosting deploy ../dist -e <envId>。' }
  tcb hosting detail -e $EnvId --json
}

# ---------- 7. 绑定 /api 路由 ----------
if (Confirm-Step '按 cloudbaserc 绑定 /api 路由（tcb deploy --only gateway）') {
  tcb deploy --only gateway -e $EnvId
  if ($LASTEXITCODE -ne 0) { Stop-WithHint '网关路由部署失败' '确认 cloudbaserc.json 的 gateway.routes 中 target 为 function:api、path 为 /api。' }
  tcb routes list -e $EnvId
}

Write-Host ""
Write-Host '如需把 /api 绑到静态托管自定义域名（而非环境默认域名），可在下面的提示里输入该域名：' -ForegroundColor DarkYellow
$Domain = Read-Host '静态托管域名（留空跳过）'
if ($Domain) {
  $routeData = @{
    domain = $Domain
    routes = @(
      @{
        path = '/api'
        upstreamResourceType = 'SCF'
        upstreamResourceName = 'api'
        enablePathTransmission = $true
      }
    )
  } | ConvertTo-Json -Depth 6 -Compress
  tcb routes add -e $EnvId --data $routeData
  if ($LASTEXITCODE -ne 0) { Stop-WithHint '给静态域名添加 /api 路由失败' '确认域名已在 CloudBase 绑定且备案/证书合规；也可在控制台「HTTP 访问服务」中添加路由。' }
}

# ---------- 8. 验证 ----------
Write-Host ""
Write-Host '验证命令（把域名替换为静态托管或网关域名）：' -ForegroundColor Cyan
Write-Host '  Invoke-RestMethod https://<域名>/api/health'
Write-Host '预期：{"ok":true,"time":"..."}'
Write-Host ''
Write-Host '部署完成。记得到 GitHub OAuth App 填回调：https://<域名>/api/oauth/github/callback'
