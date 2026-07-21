class Provider {
    constructor() {
        this.baseUrl = "https://animeav1.com";
        this.cdnUrl = "https://cdn.animeav1.com";
    }

    getSettings() {
        return {
            episodeServers: ["HLS"],
            supportsDub: true,
        };
    }

    _resolveRemixData(json, isDub) {
        if (!json || !json.nodes) return [];
        for (const node of json.nodes) {
            if (node && node.uses && node.uses.search_params) {
                const data = node.data;
                if (!data || data.length === 0) continue;

                const rootConfig = data[0];
                if (!rootConfig || typeof rootConfig.results !== 'number') continue;

                const resultsIndex = rootConfig.results;
                if (resultsIndex >= data.length) continue;

                const animePointers = data[resultsIndex];
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
                        slug: slug,
                        title: title,
                        url: `${this.baseUrl}/media/${slug}`,
                        image: realId ? `${this.cdnUrl}/covers/${realId}.jpg` : null,
                        subOrDub: isDub ? "dub" : "sub"
                    });
                }
                return results;
            }
        }
        return [];
    }

    async search(query, isDub) {
        const cleanQuery = query.trim();
        if (!cleanQuery) return [];

        const url = `${this.baseUrl}/catalogo/__data.json?page=1&search=${encodeURIComponent(cleanQuery)}`;
        try {
            const res = await fetch(url);
            if (res.status !== 200) return [];
            const json = await res.json();
            return this._resolveRemixData(json, isDub);
        } catch (e) {
            console.error("Error searching catalog: " + e.message);
            return [];
        }
    }

    async findEpisodes(slug) {
        const url = `${this.baseUrl}/media/${slug}/__data.json`;
        try {
            const res = await fetch(url);
            if (res.status !== 200) return [];
            const json = await res.json();

            const nodes = json.nodes;
            if (!Array.isArray(nodes)) return [];

            let data = null;
            let mediaDescriptor = null;

            for (const node of nodes) {
                if (!node || !Array.isArray(node.data)) continue;
                const nodeData = node.data;

                for (const obj of nodeData) {
                    if (obj && typeof obj === 'object' && 'slug' in obj && 'episodes' in obj) {
                        const slugPointer = obj.slug;
                        if (typeof slugPointer === 'number' && slugPointer < nodeData.length) {
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

            if (!data || !mediaDescriptor) return [];

            const episodesIdxVal = mediaDescriptor.episodes;
            if (typeof episodesIdxVal !== 'number' || episodesIdxVal >= data.length) return [];

            const episodeIndexes = data[episodesIdxVal];
            if (!Array.isArray(episodeIndexes)) return [];

            const mediaIdPtr = mediaDescriptor.id;
            const mediaId = (typeof mediaIdPtr === 'number' && mediaIdPtr < data.length) ? data[mediaIdPtr] : null;
            const image = mediaId ? `${this.cdnUrl}/backdrops/${mediaId}.jpg` : null;

            const result = [];
            for (let i = 0; i < episodeIndexes.length; i++) {
                const epIdx = episodeIndexes[i];
                if (typeof epIdx !== 'number' || epIdx >= data.length) continue;

                const ep = data[epIdx];
                if (!ep || typeof ep !== 'object') continue;

                let realNumber = i + 1;
                const numPtr = ep.number;
                if (typeof numPtr === 'number' && numPtr < data.length) {
                    const resolvedNum = data[numPtr];
                    if (typeof resolvedNum === 'number') {
                        realNumber = resolvedNum;
                    }
                }

                if (realNumber <= 0) continue;

                let realTitle = `Episodio ${realNumber}`;
                const titlePtr = ep.title;
                if (typeof titlePtr === 'number' && titlePtr < data.length) {
                    const resolvedTitle = data[titlePtr];
                    if (resolvedTitle) realTitle = String(resolvedTitle);
                } else if (titlePtr) {
                    realTitle = String(titlePtr);
                }

                result.push({
                    slug: slug,
                    number: realNumber,
                    title: realTitle,
                    url: `${this.baseUrl}/media/${slug}/${realNumber}`,
                    image: image,
                    type: "sub"
                });
            }
            return result;
        } catch (e) {
            console.error("Error finding episodes: " + e.message);
            return [];
        }
    }

    async findEpisodeServer(slug, episodeNumber, type) {
        const url = `${this.baseUrl}/media/${slug}/${episodeNumber}/__data.json`;
        try {
            const res = await fetch(url);
            if (res.status !== 200) return null;
            const json = await res.json();

            const nodes = json.nodes;
            if (!Array.isArray(nodes)) return null;

            let data = null;
            let root = null;

            for (const node of nodes) {
                if (node && Array.isArray(node.data)) {
                    const nodeData = node.data;
                    for (const item of nodeData) {
                        if (item && typeof item === 'object' && 'embeds' in item) {
                            data = nodeData;
                            root = item;
                            break;
                        }
                    }
                }
                if (data) break;
            }

            if (!data || !root) return null;

            const embedsIndexVal = root.embeds;
            if (typeof embedsIndexVal !== 'number' || embedsIndexVal >= data.length) return null;

            const embedsObj = data[embedsIndexVal];
            if (!embedsObj || typeof embedsObj !== 'object') return null;

            const catKey = String(type || "sub").toUpperCase();
            const listIndexVal = embedsObj[catKey];
            if (typeof listIndexVal !== 'number' || listIndexVal >= data.length) return null;

            const serverList = data[listIndexVal];
            if (!Array.isArray(serverList)) return null;

            for (const ptr of serverList) {
                if (typeof ptr !== 'number' || ptr >= data.length) continue;
                const srv = data[ptr];
                if (!srv || typeof srv !== 'object') continue;

                const serverNamePtr = srv.server;
                const urlPtr = srv.url;

                const serverName = (typeof serverNamePtr === 'number' && serverNamePtr < data.length) ? data[serverNamePtr] : null;
                const link = (typeof urlPtr === 'number' && urlPtr < data.length) ? data[urlPtr] : null;

                if (!serverName || !link) continue;

                if (serverName === "HLS") {
                    return link.replace("/play/", "/m3u8/");
                }
            }
            return null;
        } catch (e) {
            console.error("Error finding server: " + e.message);
            return null;
        }
    }
}
