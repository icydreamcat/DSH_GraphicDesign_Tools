/**
 * 加密一份文档，让它在仓库里存在、但只对拿到口令的人存在。
 *
 * WHY THIS IS A SEPARATE TOOL AND NOT A ONE-OFF
 * ---------------------------------------------
 * 有些东西需要被写下来，也需要时间。写下来是为了它不消失；时间是为了它被公正地读。
 * 两者放在一起只有一个办法：**让它存在，但先锁上**。锁不是隐藏，是给判断留出时间。
 *
 * WHY THESE PARAMETERS
 * --------------------
 * scrypt (N=2^15, r=8, p=1) 是为此类用途设计的：内存硬，所以显卡堆不出来。密钥不落盘、
 * 不进命令行（`--password` 只给脚本用），交互式输入在 TTY 上关闭回显。
 *
 * AES-256-GCM 而不是 AES-CBC：加密同时鉴权。口令错时得到的是「口令不对」，
 * 而不是一段解出来看着像乱码、实际是别人的东西的字节。
 *
 * 文件头是明文，为了可读与可搬迁：
 *
 *   -----BEGIN DSH ENCRYPTED-----
 *   v1 scrypt 32768 8 1 aes-256-gcm sha256
 *   <base64 salt (16B)>
 *   <base64 iv (12B)>
 *   <base64 ciphertext||tag>
 *   -----END DSH ENCRYPTED-----
 *
 * 结尾不是装饰：拿它校验整体完整，文件被编辑器截断或补换行时立刻能知道。
 *
 * Usage:
 *   node encrypt-doc.mjs encrypt <in.md> [out.md.enc]
 *   node encrypt-doc.mjs decrypt <in.md.enc> [out.md]
 *   node encrypt-doc.mjs inspect <in.md.enc>
 *
 * 省略输出路径则写 stdout；输入给 `-` 则读 stdin。口令从不落盘、从不写进任何文件。
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, isAbsolute, resolve } from 'node:path'

const MAGIC = 'DSH-ENCRYPTED'
const BEGIN = `-----BEGIN ${MAGIC}-----`
const END = `-----END ${MAGIC}-----`
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 }
const CIPHER = 'aes-256-gcm'

/** 口令：优先环境变量（非交互），否则在 TTY 上关闭回显提示输入。 */
async function askPassword(prompt) {
  const fromEnv = process.env.DSH_DOC_PASSWORD
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  if (process.stdin.isTTY !== true) {
    throw new Error('no password: set DSH_DOC_PASSWORD, or run this in a terminal so it can prompt')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const original = rl._writeToOutput
  // 关掉回显：这是这个函数存在的全部理由。口令出现在屏幕上也出现在历史里。
  rl._writeToOutput = function (s) { if (s.includes('\n')) original.call(rl, '\n') }
  try {
    return await new Promise((done) => rl.question(prompt, (answer) => done(answer)))
  } finally {
    rl.close()
  }
}

function derive(password, salt, params) {
  return scryptSync(password, salt, params.keylen, {
    N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem,
  })
}

export function encryptText(text, password, params = SCRYPT) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('口令不能为空')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = derive(password, salt, params)
  const cipher = createCipheriv(CIPHER, key, iv)
  const body = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
  const sealed = Buffer.concat([body, cipher.getAuthTag()])
  return [
    BEGIN,
    `v1 scrypt ${params.N} ${params.r} ${params.p} ${CIPHER}`,
    salt.toString('base64'),
    iv.toString('base64'),
    sealed.toString('base64'),
    END,
    '',
  ].join('\n')
}

/** 解析文件头。返回 null 表示这不像一份本工具产出的密文。 */
export function parseEnvelope(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (lines[0] !== BEGIN || lines[lines.length - 1] !== END) return null
  const head = /^v1 scrypt (\d+) (\d+) (\d+) ([\w-]+)$/.exec(lines[1] ?? '')
  if (head === null) return null
  if (lines.length !== 6) {
    throw new Error(`密文结构不对：应该是 6 行（首尾标记 + 参数 + salt + iv + 密文），实际 ${lines.length} 行`)
  }
  return {
    params: { N: Number(head[1]), r: Number(head[2]), p: Number(head[3]), keylen: SCRYPT.keylen, maxmem: SCRYPT.maxmem },
    cipher: head[4],
    salt: Buffer.from(lines[2], 'base64'),
    iv: Buffer.from(lines[3], 'base64'),
    sealed: Buffer.from(lines[4], 'base64'),
  }
}

export function decryptText(text, password) {
  const env = parseEnvelope(text)
  if (env === null) throw new Error('这不是本工具产出的密文（首尾标记不符）')
  if (env.cipher !== CIPHER) throw new Error(`不支持的算法 ${env.cipher}`)
  const key = derive(password, env.salt, env.params)
  const tag = env.sealed.subarray(env.sealed.length - 16)
  const body = env.sealed.subarray(0, env.sealed.length - 16)
  const decipher = createDecipheriv(CIPHER, key, env.iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    // GCM 的鉴权失败只有一种常见原因，而说清楚它比抛一个 OpenSSL 错误码有用。
    throw new Error('口令不对，或文件在加密之后被改动过（GCM 校验未通过）')
  }
}

function readInput(path) {
  if (path === '-' || path === undefined) return readFileSync(0, 'utf8')
  return readFileSync(isAbsolute(path) ? path : resolve(process.cwd(), path), 'utf8')
}

function writeOutput(path, text) {
  if (path === undefined || path === '-') { process.stdout.write(text); return }
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path)
  mkdirSync(dirname(abs), { recursive: true })
  // 无 BOM：密文里的 base64 行被加上 BOM 会让别的工具解析失败。
  writeFileSync(abs, text, 'utf8')
  process.stderr.write(`wrote ${abs}  ${Buffer.byteLength(text, 'utf8')} bytes\n`)
}

const [command, input, output] = process.argv.slice(2)

if (command === 'encrypt' || command === 'decrypt') {
  const source = readInput(input)
  const password = await askPassword(command === 'encrypt' ? '口令: ' : '口令（解密）: ')
  if (command === 'decrypt') {
    writeOutput(output, decryptText(source, password))
  } else {
    const again = process.env.DSH_DOC_PASSWORD === undefined && process.stdin.isTTY === true
      ? await askPassword('再输一次: ')
      : password
    // 打错一个字，文件就永远解不开了。确认一次是这里唯一值得多花的一步。
    if (again !== password) {
      process.stderr.write('两次输入不一致，没有写出任何文件。\n')
      process.exit(1)
    }
    writeOutput(output, encryptText(source, password))
  }
  process.exit(0)
}

if (command === 'inspect') {
  const env = parseEnvelope(readInput(input))
  if (env === null) {
    process.stderr.write('这不是本工具产出的密文。\n')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify({
    format: `v1 scrypt ${env.params.N} ${env.params.r} ${env.params.p} ${env.cipher}`,
    saltBytes: env.salt.length,
    ivBytes: env.iv.length,
    ciphertextBytes: env.sealed.length - 16,
    tagBytes: 16,
    // 不打印任何与口令有关的东西，包括长度。
  }, null, 2) + '\n')
  process.exit(0)
}

process.stderr.write(
  'encrypt-doc — 让一份文档存在，但只对拿到口令的人存在\n\n' +
  '  node encrypt-doc.mjs encrypt <in.md> [out.md.enc]\n' +
  '  node encrypt-doc.mjs decrypt <in.md.enc> [out.md]\n' +
  '  node encrypt-doc.mjs inspect <in.md.enc>\n\n' +
  '  省略输出路径则写 stdout；输入给 `-` 则读 stdin。\n' +
  '  非交互时用 DSH_DOC_PASSWORD 提供口令。口令从不落盘。\n',
)
process.exit(command === undefined ? 1 : 0)
