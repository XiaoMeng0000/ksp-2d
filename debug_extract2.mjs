import fs from 'fs';

function readVarint(buf, off) {
    let result = 0, shift = 0;
    while (true) {
        const b = buf[off++];
        result |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
    }
    return [result, off];
}

function snappyUncompress(data) {
    const [ulen, off0] = readVarint(data, 0);
    if (ulen <= 0 || ulen > 200000000) throw new Error('bad ulen ' + ulen);
    const out = Buffer.alloc(ulen);
    let o = 0, i = off0;
    while (i < data.length && o < ulen) {
        const tag = data[i++];
        const type = tag & 3;
        if (type === 0) {
            let len = (tag >> 2) + 1;
            if (len > 60) {
                const extra = len - 60;
                len = 0;
                for (let k = 0; k < extra; k++) len |= data[i++] << (8 * k);
                len += 1;
            }
            data.copy(out, o, i, i + len);
            i += len; o += len;
        } else {
            let len, offset;
            if (type === 1) {
                len = ((tag >> 2) & 0x7) + 4;
                offset = ((tag >> 5) << 8) | data[i++];
            } else if (type === 2) {
                len = (tag >> 2) + 1;
                offset = data.readUInt16LE(i); i += 2;
            } else {
                len = (tag >> 2) + 1;
                offset = data.readUInt32LE(i); i += 4;
            }
            if (offset <= 0 || offset > o) throw new Error('bad offset ' + offset + ' o=' + o);
            for (let k = 0; k < len; k++) { out[o] = out[o - offset]; o++; }
        }
    }
    if (o !== ulen) throw new Error('snappy len mismatch ' + o + ' vs ' + ulen);
    return out;
}

const dir = process.env.LOCALAPPDATA + '\\Google\\Chrome\\User Data\\Default\\Local Storage\\leveldb';
const BLOCK = 32768;
const KEY = Buffer.from('ksp2d_worlds', 'utf8');

function parseLog(file) {
    const buf = fs.readFileSync(file);
    let results = [];
    // 按 32KB block 遍历，block 内顺序读 record
    for (let blockStart = 0; blockStart + 7 <= buf.length; blockStart += BLOCK) {
        let pos = blockStart;
        let fragments = [];
        while (pos + 7 <= buf.length && pos < blockStart + BLOCK) {
            const len = buf.readUInt16LE(pos + 4);
            const type = buf[pos + 6];
            const dataStart = pos + 7;
            if (len === 0) break;
            if (dataStart + len > buf.length) break;
            if (pos + 7 + len > blockStart + BLOCK) break; // 跨 block 分片会拆 type
            const data = buf.subarray(dataStart, dataStart + len);
            if (type === 1 || type === 2) { // full / first
                fragments = [data];
                if (type === 1) {
                    results.push(fragments);
                    fragments = [];
                }
            } else if (type === 4) { // last
                fragments.push(data);
                results.push(fragments);
                fragments = [];
            } else if (type === 3) { // middle
                fragments.push(data);
            } else {
                break; // 0 = zero padding
            }
            pos = dataStart + len;
        }
    }
    return results;
}

function extractValue(recBufs) {
    let data = Buffer.concat(recBufs);
    const idx = data.indexOf(KEY);
    if (idx < 0) return null;
    // key 后跳过 \x00\x01 或 \x01
    let vStart = idx + KEY.length;
    let value = data.subarray(vStart);
    // 尝试明文：以 { 开头
    for (let k = 0; k < value.length && k < 8; k++) {
        const b = value[k];
        if (b === 123) { // {
            return { value: value.subarray(k), compressed: false };
        }
        if (b >= 32 && b < 127 && b !== 123 && b !== 34) break;
        if (b === 34) return { value: value.subarray(k), compressed: false }; // "
    }
    // 尝试 snappy
    try {
        const dec = snappyUncompress(value);
        if (dec[0] === 123 || dec[0] === 34) return { value: dec, compressed: true };
    } catch (e) {}
    return null;
}

let found = [];
for (const f of fs.readdirSync(dir)) {
    if (!/\.log$/.test(f)) continue;
    const recs = parseLog(dir + '\\' + f);
    for (const rec of recs) {
        const r = extractValue(rec);
        if (r) {
            found.push({ file: f, size: r.value.length, compressed: r.compressed });
            const text = r.value.toString('utf8');
            fs.writeFileSync('debug_worlds_dump.json', text);
            console.log('FOUND in ' + f + ' compressed=' + r.compressed + ' size=' + r.value.length);
        }
    }
}
if (found.length === 0) {
    console.log('NOT FOUND in .log files');
} else {
    console.log('dumped to debug_worlds_dump.json');
}
