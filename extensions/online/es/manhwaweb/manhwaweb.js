class Provider {
    constructor() {
        this.api = "https://manhwawebbackend-production.up.railway.app";
    }

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    async search(opts) {
        try {
            const requestRes = await fetch(`${this.api}/manhwa/library?buscar=${encodeURIComponent(opts.query)}&estado=&tipo=&erotico=&demografia=&order_item=alfabetico&order_dir=desc&page=0&generes=`, {
                method: "get",
            });

            const json = await requestRes.json();

            if (!json?.data) return [];

            return json.data.map((item) => ({
                id: item._id || item.real_id,
                title: item.the_real_name || "Sin título",
                synonyms: [item.real_id].filter(Boolean),
                year: null,
                image: item._imagen || "",
            }));
        } catch (e) {
            console.error("ManhwaWeb search error", e);
            return [];
        }
    }

    async findChapters(mangaId) {
        try {
            const requestRes = await fetch(`${this.api}/manhwa/see/${mangaId}`, {
                method: "get",
            });

            const json = await requestRes.json();

            if (!json?.chapters) return [];

            return json.chapters.map((ch, index) => ({
                id: `${json._id || mangaId}-${ch.chapter}`,
                url: ch.link || "",
                title: `Capítulo ${ch.chapter}`,
                chapter: String(ch.chapter),
                index: index,
            }));
        } catch (e) {
            console.error("ManhwaWeb findChapters error", e);
            return [];
        }
    }

    async findChapterPages(chapterId) {
        try {
            console.log(chapterId);
            const requestRes = await fetch(`${this.api}/chapters/see/${chapterId}`, {
                method: "get",
            });

            const json = await requestRes.json();

            if (!json?.chapter?.img) return [];

            return json.chapter.img.map((url, index) => ({
                url: url,
                index: index,
                headers: {
                    Referer: "https://manhwaweb.com/",
                },
            }));
        } catch (e) {
            console.error("ManhwaWeb findChapterPages error", e);
            return [];
        }
    }
}
