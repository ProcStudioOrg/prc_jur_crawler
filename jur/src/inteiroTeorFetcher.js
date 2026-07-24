// src/inteiroTeorFetcher.js
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
  '&atilde;': 'ã', '&otilde;': 'õ', '&ccedil;': 'ç', '&agrave;': 'à',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
  '&Atilde;': 'Ã', '&Otilde;': 'Õ', '&Ccedil;': 'Ç', '&Agrave;': 'À',
  '&mdash;': '\u2014', '&ndash;': '\u2013', '&nbsp;': ' ', '&ordm;': 'º', '&ordf;': 'ª',
  '&sect;': '\u00A7', '&deg;': '\u00B0',
};

function stripHtml(html) {
  if (!html) return '';

  let text = html;

  // Remove <style> and <script> blocks entirely (including content)
  // Note: do NOT remove <head> blocks — multi-document HTML from TRF4 has
  // malformed structure where <head> regex captures body content between documents
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Replace <br>, <p>, <div> closings with newlines for structure
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode named HTML entities
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.replaceAll(entity, char);
  }

  // Decode numeric HTML entities (&#123; and &#x1A;)
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  // Collapse excessive blank lines (3+ newlines → 2)
  text = text.replace(/\n{3,}/g, '\n\n');

  // Trim each line
  text = text.split('\n').map(line => line.trim()).join('\n');

  return text.trim();
}

function sanitizeFilename(name) {
  return name
    .replace(/\//g, '-')
    .replace(/[\\:*<>|]/g, '')
    .replace(/[?"]/g, '_')
    .trim();
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Detect encoding from Content-Type header (e.g., "charset= ISO-8859-1")
        const contentType = res.headers['content-type'] || '';
        const charsetMatch = contentType.match(/charset\s*=\s*([\w-]+)/i);
        const charset = charsetMatch ? charsetMatch[1].trim().toLowerCase() : 'utf-8';

        if (charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252') {
          const decoder = new TextDecoder(charset);
          resolve(decoder.decode(buf));
        } else {
          resolve(buf.toString('utf-8'));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchInteiroTeor(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const html = await httpGet(url);
      return stripHtml(html);
    } catch (err) {
      if (attempt < retries) {
        const delay = 1000 * (attempt + 1);
        console.log(`Retry ${attempt + 1}/${retries} after ${delay}ms: ${err.message}`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

async function batchDownload(results, outputDir, options = {}) {
  const concurrency = options.concurrency ?? 3;
  const delayMs = options.delayMs ?? 500;
  const log = options.log ?? console.log;

  fs.mkdirSync(outputDir, { recursive: true });

  const downloaded = [];
  let i = 0;

  while (i < results.length) {
    const batch = results.slice(i, i + concurrency);
    const promises = batch.map(async (result) => {
      if (!result.inteiroTeorLink) {
        log(`  Skipping ${result.numeroProcesso} — no inteiro teor link`);
        return null;
      }

      const filename = sanitizeFilename(result.numeroProcesso) + '.txt';
      const filepath = path.join(outputDir, filename);

      try {
        log(`  Downloading: ${result.numeroProcesso}`);
        const text = await fetchInteiroTeor(result.inteiroTeorLink);
        fs.writeFileSync(filepath, text, 'utf-8');
        return { ...result, arquivo: filename };
      } catch (err) {
        log(`  FAILED: ${result.numeroProcesso} — ${err.message}`);
        return { ...result, arquivo: null, downloadError: err.message };
      }
    });

    const batchResults = await Promise.all(promises);
    downloaded.push(...batchResults.filter(Boolean));

    i += concurrency;
    if (i < results.length) {
      await sleep(delayMs);
    }
  }

  // Write index.json
  const indexPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(downloaded, null, 2), 'utf-8');
  log(`Index saved to: ${indexPath}`);

  return downloaded;
}

module.exports = { stripHtml, sanitizeFilename, fetchInteiroTeor, httpGet, batchDownload };
