// CI 专用：由 GitHub Secrets 动态生成 cloudbase/cloudbaserc.json
// 仓库里只提交 cloudbaserc.example.json；真实密钥只在 runner 内存与临时文件里存在，不入库。
import fs from 'node:fs'
import path from 'node:path'

const envId = (process.env.TCB_ENV_ID || '').trim()
const masterKey = (process.env.EO_MASTER_KEY || '').trim()
if (!envId) {
  console.error('缺少 TCB_ENV_ID（GitHub Secrets）')
  process.exit(1)
}
if (!masterKey) {
  console.error('缺少 EO_MASTER_KEY（GitHub Secrets）')
  process.exit(1)
}

const str = (k) => (process.env[k] || '').trim()
const envVariables = {
  EO_MASTER_KEY: masterKey,
  EO_PUBLIC_BASE_URL: str('EO_PUBLIC_BASE_URL'),
  ALLOWED_ORIGIN: str('ALLOWED_ORIGIN'),
  SMTP_HOST: str('SMTP_HOST'),
  SMTP_PORT: str('SMTP_PORT'),
  SMTP_USER: str('SMTP_USER'),
  SMTP_PASS: str('SMTP_PASS'),
  SMTP_FROM: str('SMTP_FROM'),
  EO_MAIL_DEBUG: str('EO_MAIL_DEBUG') || '0',
  EO_DEBUG: str('EO_DEBUG') || '0',
  GITHUB_CLIENT_ID: str('GITHUB_CLIENT_ID'),
  GITHUB_CLIENT_SECRET: str('GITHUB_CLIENT_SECRET')
}
// 空字符串直接不写入：CloudBase 会把 "" 当成已配置，反而绕过「未配置」的 501 提示
for (const k of Object.keys(envVariables)) {
  if (!envVariables[k]) delete envVariables[k]
}

const config = {
  $schema: 'https://static.cloudbase.net/cli/cloudbaserc.schema.json',
  version: '2.1',
  envId,
  functionRoot: './functions',
  functions: [
    {
      name: 'api',
      description: 'EarthOnline 账号 / 同步 / OAuth 网关（HTTP 访问服务入口，Event 函数）',
      runtime: 'Nodejs18.15',
      handler: 'index.main',
      dir: './functions/api',
      timeout: 30,
      memorySize: 256,
      installDependency: true,
      envVariables
    }
  ],
  hosting: [
    {
      name: 'earthonline',
      root: '..',
      framework: 'static',
      outputDir: 'dist',
      deployPath: '/',
      entryFile: ['index.html'],
      ignore: ['**/*.map']
    }
  ],
  gateway: {
    routes: [{ path: '/api', target: 'function:api', enablePathTransmission: true }]
  }
}

const out = path.resolve(process.argv[2] || 'cloudbaserc.json')
fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n', 'utf8')
// 只打印键名，不打印任何值
console.log('已生成 ' + out + '，env 变量：' + Object.keys(envVariables).join(', '))
