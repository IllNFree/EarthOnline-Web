#Requires -Version 5.1
<#
  EarthOnline Cloudflare 后端部署脚本（说明性，仅供人工逐步执行）
  ------------------------------------------------------------------
  本脚本不会自动创建资源或发布：每一步都会先把命令打印出来并 Read-Host 确认，
  只有你输入 y 才会真正执行。建议逐条复制命令手工跑，效果等价。

  用法：在 cloudflare/ 目录下执行  powershell -ExecutionPolicy Bypass -File .\deploy.ps1
  前置：已安装 Node.js（含 npm），已注册 Cloudflare 账号。
#>

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$WranglerToml = Join-Path $PSScriptRoot 'wrangler.toml'
$DbName = 'eo-sync'

function Confirm-Step {
  param([string]$Title, [string[]]$CommandLines)
  Write-Host ""
  Write-Host "===== $Title =====" -ForegroundColor Cyan
  foreach ($line in $CommandLines) { Write-Host "  $line" -ForegroundColor Yellow }
  $answer = Read-Host "执行以上命令？(y = 执行 / 其它 = 跳过并退出)"
  if ($answer -ne 'y') {
    Write-Host "已停止，未执行该步骤。" -ForegroundColor DarkGray
    exit 0
  }
}

function Fail {
  param([string]$Step, [string]$Hint)
  Write-Host ""
  Write-Host "[失败] $Step" -ForegroundColor Red
  Write-Host "提示：$Hint" -ForegroundColor Red
  exit 1
}

Write-Host "EarthOnline → Cloudflare Workers + D1 部署" -ForegroundColor Green
Write-Host "工作目录：$PSScriptRoot"

# ---------- 0. 检查 wrangler ----------
Confirm-Step -Title '0/5 检查 wrangler 是否可用' -CommandLines @('npx wrangler --version')
try {
  npx wrangler --version
  if ($LASTEXITCODE -ne 0) { Fail 'wrangler 不可用' '先在 cloudflare/ 执行 npm install；仍失败请检查 Node/npm 是否在 PATH。' }
} catch {
  Fail 'wrangler 不可用' '先在 cloudflare/ 执行 npm install；仍失败请检查 Node/npm 是否在 PATH。'
}

# ---------- 1. 登录 ----------
Confirm-Step -Title '1/5 登录 Cloudflare（浏览器授权）' -CommandLines @('npx wrangler login')
npx wrangler login
if ($LASTEXITCODE -ne 0) { Fail 'wrangler login 失败' '检查网络/代理；或改用 `npx wrangler login --scopes account:read,zone:read`。' }

# ---------- 2. 创建 D1 数据库并写回 database_id ----------
Confirm-Step -Title '2/5 创建 D1 数据库' -CommandLines @("npx wrangler d1 create $DbName")
$createOutput = (npx wrangler d1 create $DbName 2>&1 | Out-String)
Write-Host $createOutput
if ($LASTEXITCODE -ne 0) {
  Fail 'd1 create 失败' '若数据库已存在（提示 already exists），直接执行 `npx wrangler d1 list` 找到 database_id 手工填进 wrangler.toml。'
}

$dbId = $null
$m = [regex]::Match($createOutput, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
if ($m.Success) { $dbId = $m.Value }

if (-not $dbId) {
  Write-Host "未从输出解析到 database_id，请手工把 uuid 填进 wrangler.toml 的 database_id。" -ForegroundColor Yellow
} else {
  Write-Host "database_id = $dbId" -ForegroundColor Green
  $writeBack = Read-Host "是否自动写回 wrangler.toml 的 database_id？(y/N)"
  if ($writeBack -eq 'y') {
    $content = [IO.File]::ReadAllText($WranglerToml)
    $content = [regex]::Replace($content, 'database_id\s*=\s*"[^"]*"', "database_id = `"$dbId`"")
    [IO.File]::WriteAllText($WranglerToml, $content, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "已写回 wrangler.toml。" -ForegroundColor Green
  } else {
    Write-Host "请手工修改 wrangler.toml：database_id = `"$dbId`"" -ForegroundColor Yellow
  }
}

# ---------- 3. 建表 ----------
Confirm-Step -Title '3/5 在远端 D1 建表' -CommandLines @("npx wrangler d1 execute $DbName --remote --file=./schema.sql")
npx wrangler d1 execute $DbName --remote --file=./schema.sql
if ($LASTEXITCODE -ne 0) {
  Fail '建表失败' '确认 wrangler.toml 的 database_id 已填且与当前账号一致；schema.sql 使用了 CREATE TABLE IF NOT EXISTS，可重复执行。'
}

# ---------- 4. 配置 secret ----------
Confirm-Step -Title '4/5 配置 EO_MASTER_KEY（必配）' -CommandLines @(
  'npx wrangler secret put EO_MASTER_KEY',
  '（提示输入时粘贴一个长随机串，例如 openssl rand -hex 32 的输出）'
)
npx wrangler secret put EO_MASTER_KEY
if ($LASTEXITCODE -ne 0) { Fail 'secret 写入失败' '确认已 login 且 worker 名称 eo-sync 存在（首次可在第 5 步之后补配）。' }
Write-Host "需要 GitHub 登录功能时，再执行：npx wrangler secret put GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET" -ForegroundColor DarkGray

# ---------- 5. 发布 ----------
Confirm-Step -Title '5/5 发布 Worker' -CommandLines @('npx wrangler deploy')
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Fail 'deploy 失败' '查看上方日志；常见原因是 wrangler.toml 的 database_id 仍是占位符。' }

Write-Host ""
Write-Host "发布完成。剩余手工事项：" -ForegroundColor Green
Write-Host "1) Cloudflare 控制台 → Workers → eo-sync → Settings → Variables，按需加 ALLOWED_ORIGIN / EO_PUBLIC_BASE_URL"
Write-Host "2) Pages 域名下新增 Worker Route：https://<pages-domain>/api/* → eo-sync（前端默认同域 /api）"
Write-Host "3) 健康检查：curl https://<worker-domain>/api/health"
