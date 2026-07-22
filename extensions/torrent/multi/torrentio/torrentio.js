class Provider {
    constructor() {
        this.url = "https://torrentio.strem.fun";
    }

    _parseTorrentioStreams(streams) {
        if (!streams) return [];
        return streams.map(s => {
            const title = s.title || '';
            const hash = s.infoHash;
            const lines = title.split('\n');
            let seeds = 0;
            let size = 0;
            let quality = "Auto";

            for (const line of lines) {
                const ln = line.trim();
                if (ln.includes('👤')) {
                    seeds = parseInt(ln.replace(/[^\d]/g, '')) || 0;
                }
                if (ln.includes('GB') || ln.includes('MB')) {
                    const match = ln.match(/(\d+\.?\d*)\s*(GB|MB)/i);
                    if (match) {
                        const num = parseFloat(match[1]);
                        size = num * (match[2].toUpperCase() === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024);
                    }
                }
                if (ln.toLowerCase().includes('1080p')) quality = '1080p';
                else if (ln.toLowerCase().includes('2160p') || ln.toLowerCase().includes('4k')) quality = '4K';
                else if (ln.toLowerCase().includes('720p')) quality = '720p';
                else if (ln.toLowerCase().includes('480p')) quality = '480p';
            }

            const trackers = (s.sources || [])
                .filter(src => src.startsWith('tracker:'))
                .map(src => src.replace('tracker:', ''));
            let magnet = `magnet:?xt=urn:btih:${hash}`;
            for (const tr of trackers) {
                magnet += `&tr=${encodeURIComponent(tr)}`;
            }

            return {
                title: title.split('\n')[0] || "Torrentio Link",
                link: magnet,
                seeders: seeds,
                leechers: 0,
                downloads: 0,
                hash: hash,
                size: size,
                accuracy: "high"
            };
        });
    }

    async search(query, isDub) {
        return [];
    }

    async single(opts, options) {
        return [];
    }

    async batch(opts, options) {
        const imdbId = opts.imdbId || (options && options.imdbId);
        const season = opts.season || opts.parentIndex || 1;
        const episode = opts.episode || opts.index || 1;

        if (!imdbId) return [];

        try {
            const res = await fetch(`${this.url}/stream/series/${imdbId}:${season}:${episode}.json`);
            if (res.status !== 200) return [];
            const data = await res.json();
            return this._parseTorrentioStreams(data.streams);
        } catch (e) {
            return [];
        }
    }

    async movie(opts, options) {
        const imdbId = opts.imdbId || (options && options.imdbId);
        if (!imdbId) return [];

        try {
            const res = await fetch(`${this.url}/stream/movie/${imdbId}.json`);
            if (res.status !== 200) return [];
            const data = await res.json();
            return this._parseTorrentioStreams(data.streams);
        } catch (e) {
            return [];
        }
    }

    async test() {
        try {
            const res = await fetch(`${this.url}/manifest.json`);
            return res.status === 200;
        } catch (error) {
            throw new Error(`Could not reach ${this.url}`);
        }
    }
}
