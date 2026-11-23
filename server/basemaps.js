/**
 * Curated basemap catalog. All layers are standard XYZ raster tiles and can be
 * swapped at runtime. Custom XYZ layers can be added from Settings.
 *
 * Catatan: layer Carto basemaps.cartocdn.com sekarang membutuhkan API key dan
 * menampilkan watermark "API KEY REQUIRED". Katalog ini memakai penyedia yang
 * tetap bisa dipakai tanpa key (Esri ArcGIS Online, OSM, OpenTopoMap).
 */
export const BASEMAPS = [
  {
    id: 'esriDark',
    name: 'Esri Dark Gray',
    group: 'Gelap',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    maxNativeZoom: 16,
    attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    dark: true,
    accent: '#111827',
  },
  {
    id: 'esriLight',
    name: 'Esri Light Gray',
    group: 'Terang',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    maxNativeZoom: 16,
    attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    dark: false,
    accent: '#e5e7eb',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    group: 'Standar',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
    dark: false,
    accent: '#d6e8c8',
  },
  {
    id: 'esriImagery',
    name: 'Esri World Imagery',
    group: 'Satelit',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    dark: true,
    accent: '#243b2b',
  },
  {
    id: 'esriTopo',
    name: 'Esri World Topo',
    group: 'Topografi',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
    dark: false,
    accent: '#e7dfc8',
  },
  {
    id: 'esriStreet',
    name: 'Esri Street Map',
    group: 'Standar',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
    dark: false,
    accent: '#e6e8ea',
  },
  {
    id: 'openTopo',
    name: 'OpenTopoMap',
    group: 'Topografi',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 17,
    attribution: '&copy; OpenStreetMap, SRTM | style &copy; OpenTopoMap',
    dark: false,
    accent: '#e3e0cf',
  },
  {
    id: 'humanitarian',
    name: 'OSM Humanitarian',
    group: 'Standar',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors, HOT',
    dark: false,
    accent: '#f0e0d0',
  },
  {
    id: 'esriNatGeo',
    name: 'Esri National Geographic',
    group: 'Referensi',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
    attribution: 'Tiles &copy; Esri, National Geographic',
    dark: false,
    accent: '#e9e2ce',
  },
  {
    id: 'none',
    name: 'Kanvas Kosong',
    group: 'Lainnya',
    url: null,
    maxZoom: 22,
    attribution: 'lintasJB NMS',
    dark: true,
    accent: '#0b1220',
  },
];

/** Map id lama (Carto) ke layer pengganti yang masih berfungsi tanpa API key. */
export const LEGACY_BASEMAP_IDS = {
  cartoDark: 'esriDark',
  cartoLight: 'esriLight',
  cartoVoyager: 'esriStreet',
};

export const BASEMAP_IDS = new Set(BASEMAPS.map((b) => b.id));

export default BASEMAPS;
