// Seanime's onlinestream provider contract.
// Declared here because the runtime supplies them: esbuild strips them while
// transpiling, which keeps this file self-contained (the repo ships no .d.ts).

const SEARCH_CACHE_MS = 5 * 60 * 1000;
const RETRY_BUDGET_MS = 8000;

const GENERIC_WORDS = {
    season: true, part: true, cour: true, movie: true, special: true,
    ova: true, ona: true, tv: true, the: true, final: true,
};

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const HLS_HEADERS = {
    "Referer": "https://player.zilla-networks.com/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "User-Agent": BROWSER_UA,
};

const SITE_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "*/*",
    "Accept-Language": "es-ES,es;q=0.9",
    "Referer": "https://animeav1.com/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
};

class Provider {
    constructor() {
        this.baseUrl = "https://animeav1.com";
        this.cdnUrl = "https://cdn.animeav1.com";
        this.normalized = {};
    }

    getSettings() {
        return {
            episodeServers: ["HLS"],
            supportsDub: true,
        };
    }

    async fetchWithRetry(url, retries = 2, headers = SITE_HEADERS) {
        const started = Date.now();
        let lastErr = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await fetch(url, { timeout: 15, headers });

                if (res.status >= 500 && attempt < retries && Date.now() - started < RETRY_BUDGET_MS) {
                    continue;
                }

                return res;
            } catch (err) {
                lastErr = err;
                if (Date.now() - started >= RETRY_BUDGET_MS) break;
            }
        }

        throw lastErr ?? new Error(`No se pudo conectar con ${url}`);
    }

    buildAnimeId(slug, isDub) {
        return JSON.stringify({ slug, type: isDub ? "dub" : "sub" });
    }

    _resolveRemixData(json, isDub) {
        if (!json || !json.nodes) return [];

        for (const node of json.nodes) {
            if (node && node.uses && node.uses.search_params) {
                const data = node.data;
                if (!data || data.length === 0) continue;

                const rootConfig = data[0];
                if (!rootConfig || typeof rootConfig.results !== "number") continue;

                const animePointers = data[rootConfig.results];
                if (!Array.isArray(animePointers)) continue;

                const results = [];

                for (const ptr of animePointers) {
                    if (typeof ptr !== 'number' || ptr >= data.length) continue;
                    const rawObj = data[ptr];
                    if (!rawObj || typeof rawObj !== 'object') continue;

                    const idPtr = rawObj.id;
                    const titlePtr = rawObj.title;
                    const slugPtr = rawObj.slug;

                    const realId = (typeof idPtr === 'number' && idPtr < data.length) ? data[idPtr] : null;
                    const title = (typeof titlePtr === 'number' && titlePtr < data.length) ? data[titlePtr] : null;
                    const slug = (typeof slugPtr === 'number' && slugPtr < data.length) ? data[slugPtr] : null;

                    if (!title || !slug) continue;

                    results.push({
                        id: this.buildAnimeId(slug, isDub),
                        slug: slug,
                        title: title,
                        url: `${this.baseUrl}/media/${slug}`,
                        image: realId ? `${this.cdnUrl}/covers/${realId}.jpg` : null,
                        subOrDub: isDub ? "dub" : "sub",
                    });
                }

                return results;
            }
        }

        return [];
    }

    normalize(value) {
        const cached = this.normalized[value];
        if (cached !== undefined) return cached;

        return (this.normalized[value] = this.normalizeUncached(value));
    }

    normalizeUncached(value) {
        return value
            .toLowerCase()
            .replace(/[áàäâã]/g, "a")
            .replace(/[éèëê]/g, "e")
            .replace(/[íìïî]/g, "i")
            .replace(/[óòöôõ]/g, "o")
            .replace(/[úùüû]/g, "u")
            .replace(/ñ/g, "n")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
            .trim();
    }

    similarity(candidate, wanted) {
        const words = this.normalize(wanted).split(" ").filter(Boolean);
        const pool = this.normalize(candidate).split(" ").filter(Boolean);
        if (words.length === 0 || pool.length === 0) return 0;

        let hits = 0;

        for (const word of words) {
            const at = pool.indexOf(word);
            if (at !== -1) {
                hits++;
                pool.splice(at, 1);
            }
        }

        return hits / words.length;
    }

    balancedScore(candidate, wanted) {
        const recall = this.similarity(candidate, wanted);
        if (recall === 0) return 0;

        const precision = this.similarity(wanted, candidate);
        if (precision === 0) return 0;

        return (2 * recall * precision) / (recall + precision);
    }

    seasonOrdinal(title) {
        const text = this.normalize(title);

        const ordinal = text.match(/\b(\d+)(?:st|nd|rd|th)?\s+season\b/);
        if (ordinal) return parseInt(ordinal[1], 10);

        const trailing = text.match(/\bseason\s+(\d+)\b/);
        if (trailing) return parseInt(trailing[1], 10);

        const roman = text.match(/\s(v?i{1,3})$/);
        if (roman) {
            const map = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
            return map[roman[1]] || 0;
        }

        return 0;
    }

    dropOtherSeasons(results, titles) {
        let wanted = 0;
        for (const title of titles) {
            const season = this.seasonOrdinal(title);
            if (season > wanted) wanted = season;
        }

        if (wanted === 0) return results;

        const kept = results.filter(r => {
            const season = this.seasonOrdinal(r.title);
            return season === 0 || season === wanted;
        });

        return kept.length > 0 ? kept : results;
    }

    narrowToBest(results, titles) {
        let best = null;
        let bestScore = 0;
        let runnerUp = 0;

        for (const result of results) {
            let score = 0;
            for (const title of titles) {
                const value = this.balancedScore(result.title, title);
                if (value > score) score = value;
            }

            if (score > bestScore) {
                runnerUp = bestScore;
                bestScore = score;
                best = result;
            } else if (score > runnerUp) {
                runnerUp = score;
            }
        }

        if (best && bestScore >= 0.5 && bestScore - runnerUp >= 0.08) return [best];

        return results;
    }

    mediaTitles(media) {
        if (!media) return [];

        return this.usableTitles([media.romajiTitle, media.englishTitle, ...(media.synonyms || [])]);
    }

    primaryTitles(media) {
        if (!media) return [];

        return this.usableTitles([media.romajiTitle, media.englishTitle]);
    }

    usableTitles(titles) {
        return titles.filter((title) => {
            if (typeof title !== "string" || title.trim() === "") return false;

            const stripped = title.replace(/\s+/g, "");
            if (stripped.length === 0) return false;

            const latin = stripped.replace(/[^a-zA-Z0-9]/g, "").length;
            if (latin / stripped.length < 0.7) return false;

            const words = this.normalize(title).split(" ").filter(Boolean);
            return words.some(w => w.length >= 3 && !GENERIC_WORDS[w]);
        });
    }

    bestScore(results, titles) {
        let best = 0;

        for (const result of results) {
            for (const title of titles) {
                const score = this.similarity(result.title, title);
                if (score > best) best = score;
            }
        }

        return best;
    }

    async searchOnce(query, isDub) {
        const key = `av1:search:${isDub ? "dub" : "sub"}:${this.normalize(query)}`;

        const cached = this.remember(key);
        if (cached) return cached;

        const url = `${this.baseUrl}/catalogo/__data.json?page=1&search=${encodeURIComponent(query)}`;
        const res = await this.fetchWithRetry(url);
        if (res.status < 200 || res.status >= 300) return [];

        const json = await res.json();
        const results = this._resolveRemixData(json, isDub);
        this.keep(key, results);

        return results;
    }

    remember(key) {
        if (typeof $store === "undefined" || !$store) return undefined;

        try {
            const hit = $store.get(key);
            if (hit && hit.value !== undefined && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.value;
        } catch (err) {
            // A store that misbehaves must not take the search down with it.
        }

        return undefined;
    }

    keep(key, value) {
        if (typeof $store === "undefined" || !$store) return;

        try {
            $store.set(key, { at: Date.now(), value });
        } catch (err) {
            // Not being able to cache is not a reason to fail.
        }
    }

    async search(queryOrOpts, isDub) {
        let query = "";
        let isDubBool = false;

        if (queryOrOpts && typeof queryOrOpts === "object") {
            query = queryOrOpts.query || "";
            isDubBool = queryOrOpts.dub || false;

            const titles = this.mediaTitles(queryOrOpts.media);
            const primary = this.primaryTitles(queryOrOpts.media);
            
            const mediaFormat = (queryOrOpts.media && typeof queryOrOpts.media.format === "string") ? queryOrOpts.media.format : "";
            const narrow = mediaFormat.toUpperCase() !== "MOVIE";

            const mediaId = (queryOrOpts.media && queryOrOpts.media.id) ? queryOrOpts.media.id : null;
            const cacheKey = mediaId ? `av1:media:${mediaId}:${isDubBool ? "dub" : "sub"}` : "";

            const cached = cacheKey ? this.remember(cacheKey) : undefined;
            if (cached) return cached;

            try {
                const results = await this.searchOnce(query, isDubBool);

                if (titles.length === 0) return results;

                if (this.bestScore(results, primary) >= 0.6) {
                    const kept = this.dropOtherSeasons(results, titles);
                    const picked = narrow ? this.narrowToBest(kept, primary) : kept;
                    if (cacheKey) this.keep(cacheKey, picked);
                    return picked;
                }

                const seen = {};
                const merged = [];

                for (const result of results) {
                    if (seen[result.id]) continue;
                    seen[result.id] = true;
                    merged.push(result);
                }

                const tried = [this.normalize(query)];

                for (const title of titles.slice(0, 3)) {
                    const key = this.normalize(title);
                    if (tried.indexOf(key) !== -1) continue;
                    tried.push(key);

                    const extra = await this.searchOnce(title, isDubBool);
                    for (const result of extra) {
                        if (seen[result.id]) continue;
                        seen[result.id] = true;
                        merged.push(result);
                    }

                    if (this.bestScore(merged, primary) >= 0.6) break;
                }

                const kept = this.dropOtherSeasons(merged, titles);
                const picked = narrow ? this.narrowToBest(kept, primary) : kept;
                if (cacheKey) this.keep(cacheKey, picked);
                return picked;
            } catch (err) {
                console.error("Error searching AnimeAV1:", err);
                return [];
            }
        } else {
            query = queryOrOpts || "";
            isDubBool = isDub || false;
            return this.searchOnce(query, isDubBool);
        }
    }

    async findEpisodes(slugOrId) {
        let slug = slugOrId;
        let type = "sub";

        if (slugOrId && typeof slugOrId === "string" && slugOrId.startsWith("{")) {
            try {
                const parsed = JSON.parse(slugOrId);
                slug = parsed.slug;
                if (parsed.type) type = parsed.type;
            } catch (e) {
                // Ignore
            }
        }

        const url = `${this.baseUrl}/media/${slug}/__data.json`;

        try {
            const res = await this.fetchWithRetry(url);
            if (res.status < 200 || res.status >= 300) throw new Error("Error fetching episodes");

            const json = await res.json();
            const nodes = json.nodes || [];

            let data = null;
            let mediaDescriptor = null;

            for (const node of nodes) {
                if (!node || !Array.isArray(node.data)) continue;
                const nodeData = node.data;

                for (const obj of nodeData) {
                    if (obj && typeof obj === "object" && "slug" in obj && "episodes" in obj) {
                        const slugPointer = obj.slug;
                        if (typeof slugPointer === "number" && slugPointer < nodeData.length) {
                            if (nodeData[slugPointer] === slug) {
                                data = nodeData;
                                mediaDescriptor = obj;
                                break;
                            }
                        }
                    }
                }

                if (data) break;
            }

            if (!data || !mediaDescriptor) throw new Error("Anime no encontrado");

            const episodesIdxVal = mediaDescriptor.episodes;
            if (typeof episodesIdxVal !== "number" || episodesIdxVal >= data.length) throw new Error("Lista inválida");

            const episodeIndexes = data[episodesIdxVal];
            if (!Array.isArray(episodeIndexes)) throw new Error("Lista vacía o inválida");

            const mediaIdPtr = mediaDescriptor.id;
            const mediaId = (typeof mediaIdPtr === "number" && mediaIdPtr < data.length) ? data[mediaIdPtr] : null;
            const image = mediaId ? `${this.cdnUrl}/backdrops/${mediaId}.jpg` : null;

            const episodes = [];

            for (let i = 0; i < episodeIndexes.length; i++) {
                const epIdx = episodeIndexes[i];
                if (typeof epIdx !== "number" || epIdx >= data.length) continue;

                const ep = data[epIdx];
                if (!ep || typeof ep !== "object") continue;

                let number = i + 1;
                const numPtr = ep.number;
                if (typeof numPtr === "number" && numPtr < data.length) {
                    const resolved = data[numPtr];
                    if (typeof resolved === "number") number = resolved;
                }

                if (!Number.isInteger(number) || number <= 0) continue;

                let title = `Episodio ${number}`;
                const titlePtr = ep.title;
                if (typeof titlePtr === "number" && titlePtr < data.length) {
                    const resolvedTitle = data[titlePtr];
                    if (resolvedTitle) title = String(resolvedTitle);
                } else if (ep.title) {
                    title = String(ep.title);
                }

                episodes.push({
                    id: JSON.stringify({ slug, number, type }),
                    slug: slug,
                    number: number,
                    title: title,
                    url: `${this.baseUrl}/media/${slug}/${number}`,
                    image: image,
                    type: type
                });
            }

            if (type === "dub" && episodes.length > 0 && !(await this.hasDub(slug, episodes[0].number))) {
                console.error(`AnimeAV1: ${slug} no tiene doblaje, se usa el sub`);

                return episodes.map(episode => ({
                    ...episode,
                    id: JSON.stringify({ slug, number: episode.number, type: "sub" }),
                    type: "sub"
                }));
            }

            return episodes;
        } catch (err) {
            console.error("Error finding episodes:", err);
            return [];
        }
    }

    async episodeEmbeds(slug, number) {
        const key = `av1:ep:${slug}:${number}`;

        const cached = this.remember(key);
        if (cached) return cached;

        const res = await this.fetchWithRetry(`${this.baseUrl}/media/${slug}/${number}/__data.json`);
        if (res.status < 200 || res.status >= 300) return null;

        const json = await res.json();

        for (const node of json?.nodes || []) {
            if (!node?.data) continue;

            const root = node.data.find(
                (item) => item && typeof item === "object" && "embeds" in item
            );

            if (root) {
                const found = { data: node.data, embeds: node.data[root.embeds] || {} };
                this.keep(key, found);
                return found;
            }
        }

        return null;
    }

    async audioTracks(slug, number) {
        const found = await this.episodeEmbeds(slug, number);
        return found ? Object.keys(found.embeds) : [];
    }

    async hasDub(slug, number) {
        const key = `av1:dub:${slug}`;

        const cached = this.remember(key);
        if (cached !== undefined) return cached;

        const dubbed = (await this.audioTracks(slug, number)).indexOf("DUB") !== -1;

        this.keep(key, dubbed);
        return dubbed;
    }

    async findEpisodeServer(slugOrEpisode, episodeNumberOrServer, typeOrEmpty) {
        let slug = "";
        let number = 0;
        let type = "sub";
        let wantedServer = "HLS";
        let isSeanime = false;

        if (slugOrEpisode && typeof slugOrEpisode === "object") {
            isSeanime = true;
            const episodeObj = slugOrEpisode;
            wantedServer = episodeNumberOrServer || "HLS";

            const rawId = episodeObj.id;
            try {
                const parsed = JSON.parse(rawId);
                slug = parsed.slug;
                number = parsed.number;
                if (parsed.type) type = parsed.type;
            } catch (e) {
                slug = rawId;
                number = episodeObj.number || 1;
            }
        } else {
            slug = slugOrEpisode;
            number = episodeNumberOrServer;
            type = typeOrEmpty || "sub";
            wantedServer = "HLS";
        }

        try {
            const found = await this.episodeEmbeds(slug, number);
            if (!found) throw new Error("No se encontraron servidores");

            const data = found.data;
            const embeds = found.embeds;
            const category = type.toUpperCase();

            let listIndex = embeds[category];
            if (typeof listIndex !== "number" && category === "DUB") {
                listIndex = embeds["SUB"];
                if (typeof listIndex === "number") {
                    console.error(`AnimeAV1: ${slug} ${number} sin doblaje, se usa el sub`);
                }
            }

            if (typeof listIndex !== "number") throw new Error(`No hay contenido en ${category}`);

            const serverList = data[listIndex];
            if (!Array.isArray(serverList)) throw new Error("Lista vacía");

            const wanted = wantedServer.trim().toUpperCase();

            let embedUrl = null;
            let serverName = null;

            for (const ptr of serverList) {
                const entry = data[ptr];
                if (!entry) continue;

                const name = data[entry.server];
                const link = data[entry.url];
                if (!name || !link) continue;

                if (String(name).trim().toUpperCase() === wanted) {
                    embedUrl = link;
                    serverName = name;
                    break;
                }
            }

            if (!embedUrl || !serverName) {
                throw new Error(`No se encontró servidor ${wantedServer} para ${type}`);
            }

            if (wanted === "HLS") {
                const playUrl = embedUrl.replace("/play/", "/m3u8/");

                if (isSeanime) {
                    return {
                        url: playUrl,
                        server: serverName,
                        headers: HLS_HEADERS,
                        videoSources: [
                            {
                                url: playUrl,
                                type: "m3u8",
                                quality: "auto",
                                subtitles: []
                            }
                        ]
                    };
                } else {
                    return playUrl;
                }
            }

            throw new Error(`Servidor no soportado: ${serverName}`);
        } catch (err) {
            console.error("Error finding episode server:", err);
            throw err;
        }
    }
}
