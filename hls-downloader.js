// hls-downloader.js - CLI 工具

import fs from 'fs/promises';
import path from 'path';
import { mkdirSync, createWriteStream, existsSync } from 'fs';
import { chromium } from 'playwright';
import axios from 'axios';
import crypto from 'crypto';
import child_process from 'child_process';

// === CLI 參數解析 ===
const targetUrl = process.argv[2];
const cookieJsonPath = process.argv[3];
if (!targetUrl || !cookieJsonPath) {
  console.error('用法: node hls-downloader.js <視訊頁URL> <cookie JSON 檔案路徑>');
  process.exit(1);
}

// === 公用工具 ===
function sanitize(str) {
  return str.replace(/[\\/:*?"<>|]/g, '');
}

async function fetchVideoTitle(url, cookies) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const json = await page.locator('script[type="application/ld+json"]').first().innerText();
  const data = JSON.parse(json);
  await browser.close();
  return sanitize(`${url.split('/').pop()}_${data.name}`);
}

async function downloadWithThrottle(url, dest, headers = {}, bytesPerSecond = 1024 * 100) {
  const writer = createWriteStream(dest);
  const res = await axios({ url, method: 'GET', responseType: 'stream', headers });
  return new Promise((resolve, reject) => {
    let downloaded = 0;
    const throttle = setInterval(() => { downloaded = 0; }, 1000);
    res.data.on('data', chunk => {
      downloaded += chunk.length;
      if (downloaded > bytesPerSecond) res.data.pause();
      setTimeout(() => res.data.resume(), 100);
    });
    res.data.pipe(writer);
    writer.on('finish', () => { clearInterval(throttle); resolve(); });
    writer.on('error', reject);
  });
}

function aesDecrypt(buffer, key, iv) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

async function parseM3U8(filePath) {
  const lines = (await fs.readFile(filePath, 'utf8')).split('\n');
  const keyLine = lines.find(line => line.includes('#EXT-X-KEY')) || '';
  const uriMatch = keyLine.match(/URI="(.*?)"/);
  const ivMatch = keyLine.match(/IV=0x([0-9a-fA-F]+)/);
  const iv = ivMatch ? Buffer.from(ivMatch[1], 'hex') : Buffer.alloc(16);
  const keyUrl = uriMatch?.[1];
  const tsList = lines.filter(line => line.endsWith('.ts'));
  return { keyUrl, iv, tsList };
}

async function processStream(m3u8Url, baseDir, name, headers) {
  const fileName = path.basename(m3u8Url.split('?')[0]);
  const m3u8Path = path.join(baseDir, fileName);

  const bitrateHint = fileName.match(/(\d+(?:\.\d+)?)([kM]bps)/i);
  if (bitrateHint) {
    console.log(`偵測到串流位元率: ${bitrateHint[0]}`);
  } else {
    console.log(`處理 m3u8: ${fileName}`);
  }

  await downloadWithThrottle(m3u8Url, m3u8Path, headers);
  const { keyUrl, iv, tsList } = await parseM3U8(m3u8Path);

  const keyName = path.basename(keyUrl.split('?')[0]);
  const keyPath = path.join(baseDir, keyName);
  await downloadWithThrottle(keyUrl, keyPath, headers);
  const key = await fs.readFile(keyPath);

  const listPath = path.join(baseDir, `${name}_${fileName}.txt`);
  const tsDir = path.join(baseDir, `${fileName}_ts`);
  mkdirSync(tsDir, { recursive: true });

  const tsListPath = [];
  for (let i = 0; i < tsList.length; i++) {
    const tsUrl = new URL(tsList[i], m3u8Url).toString();
    const tsName = path.basename(tsUrl.split('?')[0]);
    const encPath = path.join(tsDir, `enc_${tsName}`);
    const decPath = path.join(tsDir, tsName);
    if (!existsSync(decPath)) {
      await downloadWithThrottle(tsUrl, encPath, headers);
      const encBuf = await fs.readFile(encPath);
      const decBuf = aesDecrypt(encBuf, key, iv);
      await fs.writeFile(decPath, decBuf);
    }
    tsListPath.push(`file '${path.relative(baseDir, decPath)}'`);
  }
  await fs.writeFile(listPath, tsListPath.join('\n'));
  return listPath;
}

async function ffmpegConcat(listPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;
    child_process.exec(cmd, (err, stdout, stderr) => {
      if (err) reject(stderr);
      else resolve(stdout);
    });
  });
}

// === 主流程 ===
(async () => {
  const cookiesRaw = await fs.readFile(cookieJsonPath, 'utf-8');
  const cookies = JSON.parse(cookiesRaw);
  const userSession = cookies.find(c => c.name === 'user_session')?.value || '';
  if (!userSession) throw new Error('未提供 user_session cookie');

  cookies.forEach(element => {
    if(element.sameSite=="no_restriction"||element.sameSite=="unspecified")
      element.sameSite="None";
        if(element.sameSite=="lax")
      element.sameSite="Lax";
      console.log(`element.sameSite: ${element.sameSite}`);
  });

  const saveName = await fetchVideoTitle(targetUrl, cookies);
  const saveDir = path.resolve('./downloads', saveName);
  mkdirSync(saveDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  let videoUrl = '', audioUrl = '';

  context.on('response', async (res) => {
    const url = res.url();
    if (url.endsWith('.m3u8')) console.log('[m3u8]', url);
    if (url.includes('main-video') && url.endsWith('.m3u8') && !videoUrl) videoUrl = url;
    if (url.includes('main-audio') && url.endsWith('.m3u8') && !audioUrl) audioUrl = url;
  });

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout 等待 m3u8')), 15000);
    const check = () => {
      if (videoUrl && audioUrl) {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });

  return;
  await browser.close();

  const headers = { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ') };

  const videoListPath = await processStream(videoUrl, saveDir, saveName, headers);
  const audioListPath = await processStream(audioUrl, saveDir, saveName, headers);

  const videoOut = path.join(saveDir, `${saveName}_video.mp4`);
  const audioOut = path.join(saveDir, `${saveName}_audio.mp4`);
  const finalOut = path.join('./', `${saveName}.mp4`);

  await ffmpegConcat(videoListPath, videoOut);
  await ffmpegConcat(audioListPath, audioOut);

  await new Promise((resolve, reject) => {
    const cmd = `ffmpeg -i "${videoOut}" -i "${audioOut}" -c copy "${finalOut}"`;
    child_process.exec(cmd, (err, stdout, stderr) => {
      if (err) reject(stderr);
      else resolve(stdout);
    });
  });

  console.log('合併完成:', finalOut);
})();
