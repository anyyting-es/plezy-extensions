class Provider {
    getSettings() {
        return {
            episodeServers: ["vidsrc"],
            supportsDub: true,
        };
    }

    parseSeasonFromTitle(title) {
        const t = String(title || "");
        let m = t.match(/(?:season|temporada|temp|\bs)\s*(\d+)/i);
        if (m) return parseInt(m[1], 10);
        m = t.match(/\b[Ss](\d{1,2})\b/);
        if (m) return parseInt(m[1], 10);
        m = t.match(/\b[Tt](\d{1,2})\b/);
        if (m) return parseInt(m[1], 10);
        return 1;
    }

    async search(query, isDub) {
        if (query.startsWith("tmdb:")) {
            const parts = query.split(":");
            const tmdbId = parts[1];
            const type = parts[2];
            const season = parts[3] ? parseInt(parts[3], 10) : 1;
            
            const slug = type === "movie" ? `movie:${tmdbId}` : `tv:${tmdbId}:${season}`;
            return [{
                id: slug,
                slug: slug,
                title: "Direct TMDB Stream",
                year: null,
                image: ""
            }];
        }

        try {
            const url = `https://api.themoviedb.org/3/search/multi?api_key=11f51d424de962a06b01b8bec43d9afa&query=${encodeURIComponent(query)}&language=es-MX`;
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
            const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=11f51d424de962a06b01b8bec43d9afa&language=es-MX`;
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

        const finalUrl = mediaType === "movie"
            ? `https://vidsrc.mov/embed/movie/${tmdbId}`
            : `https://vidsrc.mov/embed/tv/${tmdbId}/${season}/${number}`;

        return {
            url: finalUrl
        };
    }
}
