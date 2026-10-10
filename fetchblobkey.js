const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const JWT = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJmIjowLCJzIjoyLCJ0IjoidyIsImQiOiJNSWUzdnEyajI5T21VMFJNV09EVFF2UVhpdklQbi9zekJrQi9Uc2VxQmljN1U1cjZvTVVzL0RJYTdnS09yZnEwZ2NEeE96YUxvVzVnUFBuSURMVHAwbXdhZHFNWUlLSDJ1TmZHOVNjSTlaWGF0ckxIWTNycGtRNFJCdnlKTFN3NXdDZkh1S252MGF6cnBZaXFEREZ6Q3h3R2dDWGI4RzBlaEIxdnczK2JaaWN1RGozQ0d5YkZrVmNOQ01wcExCOWo0MFVJa0E0Nm43dGhWbEV5WjA2bExrUXIrYWxWNDFMU25BQS94RTI4NkpLUzhvMjl4Zlg3TTVIZ21aei9EWG5yanJPb28wamxOVElLRWYxTS9vbzlaZz09Vnl6U29STUFOK2hVZVlYeCIsImwiOiIvYy83YWVjMmI4YWU1YWUyYzMxMTA2ODZhMjcwMjdmODQ4NTk3NWEwY2UxNjRhOGZlZWNkMTJjMDdlNzkyNWUxODA0IiwiaSI6InNoYTI1Ni1SazJ2THB3b2xML3VZdzBqTkM5aFNHY2YraFBZTjdlUVVpQ2FIOXNhRzVBPSIsImUiOjE3NzkwMzQ3MzksIm4iOiJoc3ciLCJjIjoxMDAwfQ.xBICmT7JRywGN_7bD6JEaRn_z2qfxZdf1HdWnZLtGoA";
const OUT = path.join(__dirname, 'decrypted_blob.json');

const c = { r: '\x1b[0m', d: '\x1b[2m', g: '\x1b[32m', R: '\x1b[31m', C: '\x1b[36m', y: '\x1b[33m', m: '\x1b[35m', w: '\x1b[97m', bg: '\x1b[44m' };
const log = (tag, col, ...a) => console.log(`  ${col}${tag.padEnd(10)}${c.r}`, ...a);
const hr = () => console.log(c.d + '  ' + '─'.repeat(56) + c.r);

function patch(src) {
    src = src.replace(
        'var Ux = function (Ux) {\n        var wc = 740;\n        var ss = 740;\n        var pF = new Uint8Array(16);\n        crypto.getRandomValues(pF);',
        'var Ux = function (Ux) {\n        var wc = 740;\n        var ss = 740;\n        var pF = new Uint8Array(16);\n        crypto.getRandomValues(pF);\n        if(!window._b)window._b={};window._b.iv=Array.from(pF);window._b.pt=Array.from(Ux);'
    );
    src = src.replace(
        'return xb(pF) + "." + xb(jF);\n    };\n    var wc = function ()',
        'var _r=xb(pF)+"."+xb(jF);window._b.ct=Array.from(jF);return _r;\n    };\n    var wc = function ()'
    );
    const hook = (id, body) => body
        .replace(`case ${id}:`, `case ${id}:\n                    {var _p=dq.slice();`)
        .replace(/break;$/, `if(window._b){if(!window._b.d)window._b.d=[];for(var _j=0;_j<_p.length;_j++)if(_p[_j]!==dq[_j])window._b.d.push({c:${id},i:_j,v:(_p[_j]^dq[_j])>>>0});}}break;`);
    src = src.replace(
        'case 37248:\n                    (Ux += pF - 15 - ((MZ -= (MZ - 82) * (MZ - 95) + (MZ - 95)) - 31), dq[MZ - 64 + (wc - 0) - (wc - 1)] ^= MZ - 990772906 - (wc - 429987395), dq[pF - 95 + (wc + 1) - (MZ - 64)] ^= (pF - 693344528) * (Ux - 46) + (wc - 42424361));\n                    break;',
        hook(37248, 'case 37248:\n                    (Ux += pF - 15 - ((MZ -= (MZ - 82) * (MZ - 95) + (MZ - 95)) - 31), dq[MZ - 64 + (wc - 0) - (wc - 1)] ^= MZ - 990772906 - (wc - 429987395), dq[pF - 95 + (wc + 1) - (MZ - 64)] ^= (pF - 693344528) * (Ux - 46) + (wc - 42424361));\n                    break;')
    );
    src = src.replace(
        'case 17280:\n                    (dq[Ux - 2 + (pF - 96 - (pF - 96))] ^= ((MZ - 8133797) * (MZ - 5) + (MZ - 4275496)) * (MZ - 41) + (Ux - 77095659), dq[pF - 95 + (Ux - 2)] ^= ((MZ - 38479899) * (pF - 81) + (MZ - 9565663)) * (pF - 94) + (Ux - 30120722), MZ += (MZ - 20) * (pF - 94) + (Ux - 0));\n                    break;',
        hook(17280, 'case 17280:\n                    (dq[Ux - 2 + (pF - 96 - (pF - 96))] ^= ((MZ - 8133797) * (MZ - 5) + (MZ - 4275496)) * (MZ - 41) + (Ux - 77095659), dq[pF - 95 + (Ux - 2)] ^= ((MZ - 38479899) * (pF - 81) + (MZ - 9565663)) * (pF - 94) + (Ux - 30120722), MZ += (MZ - 20) * (pF - 94) + (Ux - 0));\n                    break;')
    );
    return src;
}

function extractKey(deltas) {
    const w = [0, 0, 0, 0];
    const m = { '17280:0': 0, '17280:1': 1, '37248:2': 2, '37248:3': 3 };
    const s = new Set();
    for (const d of deltas) {
        const k = `${d.c}:${d.i}`;
        if (k in m && !s.has(k)) { w[m[k]] = d.v; s.add(k); }
        if (s.size === 4) break;
    }
    const buf = Buffer.alloc(16);
    for (let i = 0; i < 4; i++) buf.writeUInt32BE(w[i], i * 4);
    return buf;
}

function verify(key, iv, pt, ct) {
    const ivB = Buffer.from(iv), ctB = Buffer.from(ct), ptB = Buffer.from(pt);
    const dec = crypto.createDecipheriv('aes-128-cbc', key, ivB);
    const plain = Buffer.concat([dec.update(ctB), dec.final()]);
    if (!plain.equals(ptB)) return { ok: false };
    const pad = 16 - (ptB.length % 16);
    const enc = crypto.createCipheriv('aes-128-cbc', key, ivB);
    enc.setAutoPadding(false);
    const re = Buffer.concat([enc.update(Buffer.concat([ptB, Buffer.alloc(pad, pad)])), enc.final()]);
    return { ok: re.equals(ctB), plain };
}

(async () => {
    console.log(`\n  ${c.bg}${c.w} HSW BLOB KEY FETCHER ${c.r}\n`);

    log('patch', c.d, 'hsw_deobfuscated.js');
    const src = patch(fs.readFileSync(path.join(__dirname, 'hsw_deobfuscated.js'), 'utf8'));

    const tmp = path.join(__dirname, '__tmp.html');
    fs.writeFileSync(tmp, `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
<script>window._b={};</script>
<script>${src.replace(/<\/script>/gi, '<\\/script>')}</script>
<script>(async()=>{try{window._b.hsw=await hsw(${JSON.stringify(JWT)})}catch(e){window._b.err=e.message}window._b.ok=1})();</script>
</body></html>`, 'utf8');

    log('chrome', c.d, 'launching');
    const browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new',
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');
    page.on('pageerror', e => log('error', c.R, e.message));

    log('run', c.C, 'hsw()');
    await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window._b?.ok, { timeout: 30000 });
    const d = await page.evaluate(() => window._b);
    await browser.close();
    fs.unlinkSync(tmp);

    if (d.err) { log('fail', c.R, d.err); process.exit(1); }

    hr();
    log('captured', c.d, `${d.pt.length}b pt  ${d.ct.length}b ct  ${d.d.length} deltas`);

    const stable = [0, 1, 2, 3].map(i => {
        const ci = i < 2 ? 17280 : 37248, ii = i < 2 ? i : i;
        const vals = d.d.filter(x => x.c === ci && x.i === ii).map(x => x.v);
        return vals.every(v => v === vals[0]);
    });
    log('stability', stable.every(Boolean) ? c.g : c.y, stable.every(Boolean) ? 'all 4 words constant across all blocks' : 'UNSTABLE');

    const key = extractKey(d.d);
    hr();
    log('KEY', c.m, `${c.w}${key.toString('hex')}${c.r}`);
    log('base64', c.d, key.toString('base64'));
    log('iv', c.d, Buffer.from(d.iv).toString('hex'));
    hr();

    try {
        const v = verify(key, d.iv, d.pt, d.ct);
        if (v.ok) {
            log('decrypt', c.g, 'OK');
            log('encrypt', c.g, 'OK — key confirmed');

            const txt = v.plain.toString('utf8');
            const parsed = JSON.parse(txt);
            fs.writeFileSync(OUT, JSON.stringify(parsed, null, 2), 'utf8');
            log('saved', c.C, OUT);
        } else {
            log('verify', c.R, 'FAILED');
        }
    } catch (e) {
        log('verify', c.R, e.message);
    }

    console.log();
})().catch(e => { log('fatal', c.R, e.message); process.exit(1); });
