class Provider {
    constructor() {
        this.url = "https://feed.animetosho.xyz/feed/json";
    }

    _buildQuery(options) {
        const base = "&qx=1&q=(multi*|multisub*)";
        const exclusions = options.exclusions;
        const resolution = options.resolution;
        const QUALITIES = [ "1080", "720", "540", "480" ];

        if ((!exclusions || !exclusions.length) && !resolution) return base;
        
        let excl = "";
        if (exclusions && exclusions.length) {
            excl = `!("${exclusions.join('"|"')}")`;
        }
        
        if (!resolution) return base + excl;
        return base + excl + `!(*${QUALITIES.filter(q => q !== resolution).join("*|*")}*)`;
    }

    map(entries, batch, useTorrent) {
        return entries.map(entry => ({
            title: entry.title || entry.torrent_name,
            link: useTorrent ? entry.torrent_url : entry.magnet_uri,
            seeders: (entry.seeders || 0) >= 30000 ? 0 : entry.seeders || 0,
            leechers: (entry.leechers || 0) >= 30000 ? 0 : entry.leechers || 0,
            downloads: entry.torrent_downloaded_count || 0,
            hash: entry.info_hash,
            size: entry.total_size,
            accuracy: (entry.anidb_fid && !batch) ? "high" : "medium",
            type: batch ? "batch" : undefined,
            date: new Date(1000 * entry.timestamp)
        }));
    }

    async search(query, isDub) {
        if (!query) return [];
        const res = await fetch(this.url + "?q=" + encodeURIComponent(query));
        const data = await res.json();
        return data.length ? this.map(data, false, false) : [];
    }

    async single(opts, options) {
        const anidbEid = opts.anidbEid;
        if (!anidbEid) throw new Error("No anidbEid provided");
        const query = this._buildQuery({
            resolution: opts.resolution,
            exclusions: opts.exclusions
        });
        const res = await fetch(this.url + "?eid=" + anidbEid + query);
        const data = await res.json();
        return data.length ? this.map(data, false, options?.useTorrent) : [];
    }

    async batch(opts, options) {
        const anidbAid = opts.anidbAid;
        const episode = opts.episode;
        if (!anidbAid) throw new Error("No anidbAid provided");
        const query = this._buildQuery({
            resolution: opts.resolution,
            exclusions: opts.exclusions
        });
        const res = await fetch(this.url + "?order=size-d&aid=" + anidbAid + query);
        const json = await res.json();
        const data = json.filter(entry => entry.num_files >= Math.min(24, Math.max(2, episode ?? 1)));
        return data.length ? this.map(data, true, options?.useTorrent) : [];
    }

    async movie(opts, options) {
        const anidbAid = opts.anidbAid;
        if (!anidbAid) throw new Error("No anidbAid provided");
        const query = this._buildQuery({
            resolution: opts.resolution,
            exclusions: opts.exclusions
        });
        const res = await fetch(this.url + "?aid=" + anidbAid + query);
        const data = await res.json();
        return data.length ? this.map(data, false, options?.useTorrent) : [];
    }

    async test() {
        try {
            const res = await fetch(this.url);
            if (!res.status === 200) throw new Error(`Failed to load data from ${this.url}`);
            return true;
        } catch (error) {
            throw new Error(`Could not reach ${this.url}`);
        }
    }
}
