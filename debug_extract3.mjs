import fs from 'fs';

const KEY = Buffer.from('ksp2d_worlds', 'utf8');
const BLOCK = 32768;

function parseLog(buf) {
    const recs = [];
    for (let bs = 0; bs + 7 <= buf.length; bs += BLOCK) {
        let pos = bs;
        while (pos + 7 <= buf.length && pos < bs + BLOCK) {
            const len = buf.readUInt16LE(pos + 4);
            const type = buf[pos + 6];
            const ds = pos + 7;
            if (len === 0 || ds + len > buf.length || pos + 7 + len > bs + BLOCK) break;
            recs.push({ type, data: buf.subarray(ds, ds + len) });
            pos = ds + len;
        }
    }
    return recs;
}

function decodeUTF16(buf) {
    // 过滤尾部非对齐字节
    const clean = buf.length % 2 === 0 ? buf : buf.subarray(0, buf.length - 1);
    return clean.toString('utf16le');
}

function extractValue(recBuf) {
    const idx = recBuf.indexOf(KEY);
    if (idx < 0) return null;
    let v = recBuf.subarray(idx + KEY.length);
    // 跳过 key 结束标记 \x00\x01 / \x01
    if (v[0] === 0 && v[1] === 1) v = v.subarray(2);
    else if (v[0] === 1) v = v.subarray(1);
    return v;
}

function analyze(text) {
    try {
        const data = JSON.parse(text);
        const worlds = data._worlds || {};
        const wlist = data._worldList || [];
        console.log('  worldList: ' + JSON.stringify(wlist));
        for (const id of Object.keys(worlds)) {
            const w = worlds[id];
            const cps = (w.checkpoints || []).length;
            console.log('  world: ' + id + '  name=' + JSON.stringify(w.metadata && w.metadata.name) + '  checkpoints=' + cps + '  activeCp=' + (w.activeCheckpointId || ''));
            (w.checkpoints || []).forEach((cp, i) => {
                const ship0 = cp.ships && cp.ships[0];
                const fac0 = cp.facilities && cp.facilities[0];
                console.log(`    cp[${i}] ${cp.id || ''} gameTime=${cp.gameTime} ships=${cp.ships ? cp.ships.length : 0} facs=${cp.facilities ? cp.facilities.length : 0}` +
                    (ship0 ? ` ship0: soi=${ship0.currentSOI} gm=${ship0.currentGM} pos=(${ship0.pos.x},${ship0.pos.y}) vel=(${ship0.vel.x},${ship0.vel.y}) kepler=${JSON.stringify(ship0.kepler)} orbitTime=${ship0.orbitTime}` : ''));
            });
        }
    } catch (e) {
        console.log('  JSON parse failed: ' + e.message);
        console.log('  raw head: ' + text.slice(0, 300));
    }
}

function scanDir(dir, tag) {
    if (!fs.existsSync(dir)) { console.log('[' + tag + '] dir missing'); return; }
    for (const f of fs.readdirSync(dir)) {
        if (!/\.log$/.test(f)) continue;
        const recs = parseLog(fs.readFileSync(dir + '\\' + f));
        console.log('\n[' + tag + '] ' + f + ' records=' + recs.length);
        let seenWorlds = 0;
        for (const r of recs) {
            const v = extractValue(r.data);
            if (v) {
                seenWorlds++;
                const text = decodeUTF16(v);
                console.log('  --- ksp2d_worlds record #' + seenWorlds + ' (type=' + r.type + ') ---');
                analyze(text);
            }
        }
        if (seenWorlds === 0) {
            // 打印所有可读 key 片段
            for (const r of recs) {
                const s = decodeUTF16(r.data);
                const clean = s.replace(/[^\x20-\x7e]/g, '.');
                console.log('  key? type=' + r.type + ' len=' + r.data.length + ' head=' + clean.slice(0, 80));
            }
        }
    }
}

const chrome = process.env.LOCALAPPDATA + '\\Google\\Chrome\\User Data\\Default\\Local Storage\\leveldb';
const edge = process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\User Data\\Default\\Local Storage\\leveldb';
scanDir(chrome, 'CHROME');
scanDir(edge, 'EDGE');
