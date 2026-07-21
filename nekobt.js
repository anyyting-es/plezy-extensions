const QUALITIES = [ "1080", "720", "540", "480" ];

class Provider {
  constructor() {
    this.url = "https://nekobt.to/api/v1/";
  }

  async _fetch(search) {
    const res = await fetch(`${this.url}torrents/search?${search}`);
    const json = await res.json();
    if (json.error) throw new Error("NekoBT: " + json.message);
    if (!json.data) throw new Error("NekoBT: Invalid response from server!");
    return json.data;
  }

  async search(query, isDub) {
    if (!query) return [];
    const searchParams = new URLSearchParams({
      q: query,
      limit: "30"
    });
    const data = await this._fetch(searchParams);
    return data.results?.map(entry => ({
      title: entry.title,
      link: `${this.url}torrents/${entry.id}/download?public=true`,
      seeders: Number(entry.seeders),
      leechers: Number(entry.leechers),
      downloads: Number(entry.completed),
      hash: entry.infohash,
      size: Number(entry.filesize),
      accuracy: "medium",
      date: new Date(entry.uploaded_at)
    })) ?? [];
  }

  async single(opts, options) {
    const tvdbId = opts.tvdbId;
    const tvdbEId = opts.tvdbEId;
    const tmdbId = opts.tmdbId;
    const episode = opts.episode;
    const resolution = opts.resolution;
    const exclusions = opts.exclusions || [];

    const mediaParams = new URLSearchParams({ limit: "1" });
    if (tvdbId) mediaParams.append("tvdbid", tvdbId.toString());
    if (tmdbId) mediaParams.append("tmdbid", tmdbId.toString());

    const mappings = await this._fetch(mediaParams);
    if (!mappings?.media) throw new Error("NekoBT: No media found for the given anime!");

    const ep = mappings.media.episodes?.find(ep => ep.tvdbId === tvdbEId) ?? mappings.media.episodes?.find(ep => ep.episode === episode);
    if (!ep?.id) return [];

    const searchParams = new URLSearchParams({
      media_id: mappings.media.id,
      episode_ids: ep.id.toString()
    });

    const high = ep?.tvdbId === tvdbEId;
    const excl = resolution ? exclusions.concat(...QUALITIES.filter(q => q !== resolution).map(q => `${q}p`)) : exclusions;

    const data = await this._fetch(searchParams);
    return data.results?.filter(({title}) => {
      if (!excl.length) return true;
      const lowerTitle = title.toLowerCase();
      return !excl.some(e => lowerTitle.includes(e.toLowerCase()));
    }).map(entry => ({
      title: entry.title,
      link: `${this.url}torrents/${entry.id}/download?public=true`,
      seeders: Number(entry.seeders),
      leechers: Number(entry.leechers),
      downloads: Number(entry.completed),
      hash: entry.infohash,
      size: Number(entry.filesize),
      accuracy: high ? "high" : "medium",
      type: (entry.level ?? 0) >= 3 ? "alt" : entry.batch ? "batch" : undefined,
      date: new Date(entry.uploaded_at)
    })) ?? [];
  }

  async movie(opts, options) {
    const tvdbId = opts.tvdbId;
    const tmdbId = opts.tmdbId;
    const resolution = opts.resolution;
    const exclusions = opts.exclusions || [];

    const mediaParams = new URLSearchParams({ limit: "1" });
    if (tvdbId) mediaParams.append("tvdbid", tvdbId.toString());
    if (tmdbId) mediaParams.append("tmdbid", tmdbId.toString());

    const mappings = await this._fetch(mediaParams);
    if (!mappings?.media) throw new Error("NekoBT: No media found!");

    const searchParams = new URLSearchParams({
      media_id: mappings.media.id
    });

    const excl = resolution ? exclusions.concat(...QUALITIES.filter(q => q !== resolution).map(q => `${q}p`)) : exclusions;

    const data = await this._fetch(searchParams);
    return data.results?.filter(({title}) => {
      if (!excl.length) return true;
      const lowerTitle = title.toLowerCase();
      return !excl.some(e => lowerTitle.includes(e.toLowerCase()));
    }).map(entry => ({
      title: entry.title,
      link: `${this.url}torrents/${entry.id}/download?public=true`,
      seeders: Number(entry.seeders),
      leechers: Number(entry.leechers),
      downloads: Number(entry.completed),
      hash: entry.infohash,
      size: Number(entry.filesize),
      accuracy: "medium",
      type: (entry.level ?? 0) >= 3 ? "alt" : entry.batch ? "batch" : undefined,
      date: new Date(entry.uploaded_at)
    })) ?? [];
  }

  async test() {
    try {
      const res = await fetch(this.url + "announcements");
      return res.status === 200;
    } catch (error) {
      throw new Error(`Could not reach ${this.url}`);
    }
  }
}
