class Provider {
    constructor() {
        this.apiKey = "11f51d424de962a06b01b8bec43d9afa";
        this.vidsrcApi = "https://data.vidsrcme.ru/api.php";
    }

    getSettings() {
        return {
            episodeServers: ["vidsrc"],
            supportsDub: true,
        };
    }

    // ---------------------------------------------------------------- helpers

    parseSeasonFromTitle(title) {
        const t = String(title || "");
        let m = t.match(/(?:season|temporada|temp|\bs)\s*(\d+)/i);
        if (m) return parseInt(m[1], 10);
        m = t.match(/\b[Ss](\d{1,2})\b/);
        if (m) return parseInt(m[1], 10);
        m = t.match(/\b[Tt](\d{1,2})\b/);
        if (m) return parseInt(m[1], 10);
        return 1; // Default to Season 1
    }

    // ---------------------------------------------------------------- search

    async search(query, isDub) {
        try {
            const url = `https://api.themoviedb.org/3/search/multi?api_key=${this.apiKey}&query=${encodeURIComponent(query)}&language=es-MX`;
            const res = await fetch(url);
            if (!res.ok) return [];
            
            const json = await res.json();
            if (!json || !json.results) return [];

            const results = [];
            const detectedSeason = this.parseSeasonFromTitle(query);

            for (const item of json.results) {
                if (item.media_type !== "movie" && item.media_type !== "tv") continue;
                
                const tmdbId = item.id;
                const type = item.media_type;
                const title = item.title || item.name || "Sin título";
                const dateStr = item.release_date || item.first_air_date || "";
                const year = dateStr ? parseInt(dateStr.split("-")[0], 10) : null;
                const image = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "";

                const slug = type === "tv" ? `tv:${tmdbId}:${detectedSeason}` : `movie:${tmdbId}`;

                results.push({
                    id: slug,
                    slug: slug,
                    title: title,
                    year: year,
                    image: image,
                });
            }
            return results;
        } catch (e) {
            console.error("VidSrc search error:", e);
            return [];
        }
    }

    // ---------------------------------------------------------------- findEpisodes

    async findEpisodes(slugOrId) {
        let slug = slugOrId;
        if (slugOrId && typeof slugOrId === "string" && slugOrId.startsWith("{")) {
            try {
                const parsed = JSON.parse(slugOrId);
                slug = parsed.slug || slugOrId;
            } catch (e) {}
        }

        const parts = slug.split(":");
        const type = parts[0];
        const tmdbId = parts[1];
        const season = parts[2] ? parseInt(parts[2], 10) : 1;

        if (type === "movie") {
            return [{
                id: `movie:${tmdbId}:1`,
                slug: slug,
                number: 1,
                title: "Película",
                url: `movie:${tmdbId}:1`,
            }];
        }

        try {
            const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${this.apiKey}&language=es-MX`;
            const res = await fetch(url);
            if (!res.ok) return [];
            
            const json = await res.json();
            if (!json || !json.episodes) return [];

            const episodes = [];
            for (const ep of json.episodes) {
                episodes.push({
                    id: `tv:${tmdbId}:${season}:${ep.episode_number}`,
                    slug: slug,
                    number: ep.episode_number,
                    title: ep.name || `Episodio ${ep.episode_number}`,
                    url: `tv:${tmdbId}:${season}:${ep.episode_number}`,
                });
            }
            return episodes;
        } catch (e) {
            console.error("VidSrc findEpisodes error:", e);
            return [];
        }
    }

    // ---------------------------------------------------------------- findEpisodeServer

    async findEpisodeServer(slugOrEpisode, episodeNumberOrServer, typeOrEmpty, seasonNumber) {
        let slug = "";
        let number = 1;

        if (slugOrEpisode && typeof slugOrEpisode === "object") {
            slug = slugOrEpisode.id || slugOrEpisode.slug || "";
            number = slugOrEpisode.number || 1;
        } else {
            slug = slugOrEpisode;
            number = episodeNumberOrServer || 1;
        }

        if (slug.startsWith("{")) {
            try {
                const parsed = JSON.parse(slug);
                slug = parsed.slug || slug;
            } catch (e) {}
        }

        const parts = slug.split(":");
        const mediaType = parts[0] === "movie" ? "movie" : "tv";
        const tmdbId = parts[1] || parts[0];
        
        let season = 1;
        if (parts[2]) {
            season = parseInt(parts[2], 10);
        } else if (seasonNumber) {
            season = parseInt(seasonNumber, 10);
        }

        const params = mediaType === "movie"
            ? `type=movie&tmdb=${tmdbId}&stream_urls=1`
            : `type=tv&tmdb=${tmdbId}&season=${season}&episode=${number}&stream_urls=1`;

        try {
            const res = await fetch(`${this.vidsrcApi}?${params}`);
            if (!res.ok) throw new Error("vidsrc: request failed with status " + res.status);
            
            const full = await res.json();
            const data = full?.data;
            const blobB64 = data?.stream_urls;

            if (!blobB64) {
                throw new Error("vidsrc: no stream_urls returned");
            }

            const wasmUrl = full?.vs?.wasm_url;
            const wasm = wasmUrl ? await this.fetchBytes(wasmUrl) : null;
            if (!wasm || wasm.length === 0) {
                throw new Error("vidsrc: failed to fetch wasm");
            }

            const urls = this.decryptUrls(wasm, blobB64);
            if (!urls || urls.length === 0) {
                throw new Error("vidsrc: failed to decrypt stream urls");
            }

            const master = urls[0];
            const token = await this.fetchToken(master);
            const finalUrl = token ? `${master}?token=${encodeURIComponent(token)}` : master;

            return {
                url: finalUrl
            };
        } catch (e) {
            console.error("VidSrc findEpisodeServer error:", e);
            throw e;
        }
    }

    async fetchBytes(url) {
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
                if (!res.ok) continue;
                
                if (res.body) {
                    const arr = new Uint8Array(res.body.length);
                    for (let i = 0; i < res.body.length; i++) {
                        arr[i] = res.body[i];
                    }
                    if (arr.length > 0) return arr;
                }
            } catch (err) {
                // retry
            }
            if (attempt < 3) {
                await this.sleep(500);
            }
        }
        return null;
    }

    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async fetchToken(masterUrl) {
        try {
            const origin = new URL(masterUrl).origin;
            const res = await fetch(`${origin}/generate.php`);
            if (!res.ok) return "";
            const text = await res.text();
            return text && !text.startsWith("<") ? text.trim() : "";
        } catch (e) {
            return "";
        }
    }

    // ---------------------------------------------------------------- decryption

    decryptUrls(wasm, blobB64) {
        let segs = [];
        if (wasm && wasm.length > 8) {
            segs = this.parseDataSegments(wasm);
        } else {
            return null;
        }

        const blob = this.base64ToBytes(blobB64);
        const nonce = blob.subarray(0, 12);
        const ct = blob.subarray(12);

        for (let i = 0; i < segs.length; i++) {
            for (let j = i + 1; j < segs.length; j++) {
                const a = segs[i].bytes;
                const b = segs[j].bytes;
                if (a.length < 32 || b.length < 32) continue;
                
                const key = new Uint8Array(32);
                for (let k = 0; k < 32; k++) {
                    key[k] = a[k] ^ b[k];
                }
                
                const plain = this.chachaXor(key, 0, nonce, ct);
                const txt = this.decodeUtf8(plain);
                if (/https?:\/\//.test(txt) || /m3u8|\.mp4/.test(txt)) {
                    const urls = txt.split("\n").map(s => s.trim()).filter(s => s.length > 0);
                    if (urls.length > 0) return urls;
                }
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- WASM MVP parser

    readUleb(buf, off) {
        let r = 0, s = 0;
        for (;;) {
            const b = buf[off++];
            r |= (b & 0x7f) << s;
            if (!(b & 0x80)) return [r, off];
            s += 7;
        }
    }

    parseDataSegments(buf) {
        const segs = [];
        let off = 8;
        while (off < buf.length) {
            const sid = buf[off++];
            let size;
            [size, off] = this.readUleb(buf, off);
            if (sid === 11) {
                let cnt;
                [cnt, off] = this.readUleb(buf, off);
                for (let i = 0; i < cnt; i++) {
                    const flag = buf[off++];
                    let offset = -1;
                    if (flag === 0) {
                        const op = buf[off++];
                        if (op === 0x41) {
                            let v;
                            [v, off] = this.readUleb(buf, off);
                            offset = v;
                            off++;
                        } else if (op === 0x42) {
                            let v;
                            [v, off] = this.readUleb(buf, off);
                            offset = v;
                            off++;
                        }
                    } else if (flag === 2) {
                        let m;
                        [m, off] = this.readUleb(buf, off);
                        const op = buf[off++];
                        if (op === 0x41) {
                            let v;
                            [v, off] = this.readUleb(buf, off);
                            offset = v;
                            off++;
                        }
                    }
                    let len;
                    [len, off] = this.readUleb(buf, off);
                    segs.push({ offset, bytes: buf.slice(off, off + len) });
                    off += len;
                }
                break;
            }
            off += size;
        }
        return segs;
    }

    // ---------------------------------------------------------------- ChaCha20 (IETF)

    rotl(x, n) {
        return ((x << n) | (x >>> (32 - n))) >>> 0;
    }

    QR(x, a, b, c, d) {
        x[a] = (x[a] + x[b]) >>> 0; x[d] = this.rotl(x[d] ^ x[a], 16);
        x[c] = (x[c] + x[d]) >>> 0; x[b] = this.rotl(x[b] ^ x[c], 12);
        x[a] = (x[a] + x[b]) >>> 0; x[d] = this.rotl(x[d] ^ x[a], 8);
        x[c] = (x[c] + x[d]) >>> 0; x[b] = this.rotl(x[b] ^ x[c], 7);
    }

    chachaBlock(key, counter, nonce) {
        const st = new Uint32Array(16);
        const c = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
        for (let i = 0; i < 4; i++) st[i] = c[i];
        for (let i = 0; i < 8; i++) {
            st[4 + i] = ((key[4 * i] | (key[4 * i + 1] << 8) | (key[4 * i + 2] << 16) | (key[4 * i + 3] << 24)) >>> 0);
        }
        st[12] = counter >>> 0;
        for (let i = 0; i < 3; i++) {
            st[13 + i] = ((nonce[4 * i] | (nonce[4 * i + 1] << 8) | (nonce[4 * i + 2] << 16) | (nonce[4 * i + 3] << 24)) >>> 0);
        }

        const x = new Uint32Array(st);
        for (let i = 0; i < 10; i++) {
            this.QR(x, 0, 4, 8, 12); this.QR(x, 1, 5, 9, 13); this.QR(x, 2, 6, 10, 14); this.QR(x, 3, 7, 11, 15);
            this.QR(x, 0, 5, 10, 15); this.QR(x, 1, 6, 11, 12); this.QR(x, 2, 7, 8, 13); this.QR(x, 3, 4, 9, 14);
        }
        const out = new Uint8Array(64);
        for (let i = 0; i < 16; i++) {
            const v = (x[i] + st[i]) >>> 0;
            out[4 * i] = v & 0xff; out[4 * i + 1] = (v >>> 8) & 0xff; out[4 * i + 2] = (v >>> 16) & 0xff; out[4 * i + 3] = (v >>> 24) & 0xff;
        }
        return out;
    }

    chachaXor(key, counter, nonce, data) {
        const out = new Uint8Array(data.length);
        let c = counter;
        for (let off = 0; off < data.length; off += 64) {
            const block = this.chachaBlock(key, c, nonce);
            const n = Math.min(64, data.length - off);
            for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ block[i];
            c = (c + 1) >>> 0;
        }
        return out;
    }

    // ---------------------------------------------------------------- byte helpers

    base64ToBytes(str) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const lookup = new Uint8Array(256);
        for (let i = 0; i < chars.length; i++) {
            lookup[chars.charCodeAt(i)] = i;
        }
        
        let bufferLength = str.length * 0.75;
        if (str[str.length - 1] === "=") {
            bufferLength--;
            if (str[str.length - 2] === "=") {
                bufferLength--;
            }
        }
        
        const bytes = new Uint8Array(bufferLength);
        let p = 0;
        for (let i = 0; i < str.length; i += 4) {
            const num1 = lookup[str.charCodeAt(i)];
            const num2 = lookup[str.charCodeAt(i + 1)];
            const num3 = lookup[str.charCodeAt(i + 2)];
            const num4 = lookup[str.charCodeAt(i + 3)];
            
            bytes[p++] = (num1 << 2) | (num2 >> 4);
            if (p < bufferLength) bytes[p++] = ((num2 & 15) << 4) | (num3 >> 2);
            if (p < bufferLength) bytes[p++] = ((num3 & 3) << 6) | num4;
        }
        return bytes;
    }

    decodeUtf8(bytes) {
        let out = "";
        let i = 0;
        while (i < bytes.length) {
            const b = bytes[i];
            if (b < 0x80) {
                out += String.fromCharCode(b);
                i++;
            } else {
                let len = 1;
                if (b >= 0xc0 && b < 0xe0) len = 2;
                else if (b >= 0xe0 && b < 0xf0) len = 3;
                else if (b >= 0xf0) len = 4;
                
                let val = 0;
                if (len === 2) val = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
                else if (len === 3) val = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
                else if (len === 4) val = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
                
                out += String.fromCharCode(val);
                i += len;
            }
        }
        return out;
    }
}
