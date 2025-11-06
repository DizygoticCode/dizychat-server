#!/usr/bin/env node
import https from 'https';
import { URL } from 'url';
import cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36';

function fetchText(url) {
  return new Promise((resolve,reject)=>{
    const u = new URL(url);
    const req = https.request(u, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate, br' }
    }, res => {
      if (res.statusCode>=300 && res.statusCode<400 && res.headers.location) {
        res.resume(); return resolve(fetchText(new URL(res.headers.location, url).toString()));
      }
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    }); req.on('error',reject); req.end();
  });
}

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/resolve-board.mjs <url-or-slug>'); process.exit(1); }

(async ()=>{
  let url = input.startsWith('http') ? input : `https://www.101soundboards.com/boards/${input}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href');
  const out = canonical || url;
  const slug = new URL(out).pathname.split('/').filter(Boolean).pop();
  console.log(slug);
})();