import express from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { getDb, save } from '../lib/store.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { haversine, pathLength } from '../lib/geo.js';
import { licenseStatus } from '../lib/license.js';
import { pushActivity, uid } from '../lib/faults.js';
import { emitEvent } from '../lib/events.js';
import { BASEMAPS } from '../basemaps.js';
import { asyncHandler, cleanText, httpError, requireFields, resolveProject, visibleProjects } from './helpers.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(kml|kmz|geojson|json|csv)$/i.test(file.originalname || '');
    if (!ok) {
      cb(new Error('Format file harus KML, KMZ, GeoJSON, atau CSV.'));
      return;
    }
    cb(null, true);
  },
});

const NODE_TYPES = ['pop', 'router', 'server', 'olt', 'odc', 'odp', 'ont', 'closure'];
const CABLE_TYPES = ['backbone', 'feeder', 'distribution', 'drop'];
const COLORS = {
  backbone: '#22d3ee',
  feeder: '#a3e635',
  distribution: '#f59e0b',
  drop: '#f472b6',
};

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripTags(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferNodeType(value, name = '') {
  const raw = String(value || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  for (const type of NODE_TYPES) {
    if (raw === type || raw.includes(type)) return type;
  }
  if (/joint|closure|jc\b/.test(raw) || /\bjc\b|joint/.test(n)) return 'closure';
  if (/server|nms/.test(raw) || /server|nms/.test(n)) return 'server';
  if (/router|mikrotik|ccr|rb5/.test(raw) || /router|ccr|rb5/.test(n)) return 'router';
  if (/pop|site/.test(raw) || /\bpop\b/.test(n)) return 'pop';
  if (/olt/.test(raw) || /\bolt\b|hioso|huawei|zte/.test(n)) return 'olt';
  if (/odc/.test(raw) || /\bodc\b/.test(n)) return 'odc';
  if (/ont|onu|cpe/.test(raw) || /\bont\b|\bonu\b/.test(n)) return 'ont';
  if (/odp|odp\b/.test(raw) || /\bodp\b/.test(n)) return 'odp';
  return 'odp';
}

function inferCableType(value, name = '') {
  const raw = String(value || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  for (const type of CABLE_TYPES) if (raw.includes(type) || n.includes(type)) return type;
  if (/backbone|bb\b/.test(raw) || /backbone|\bbb\b/.test(n)) return 'backbone';
  if (/feeder|fd\b/.test(raw) || /feeder|\bfd\b/.test(n)) return 'feeder';
  if (/drop|dr\b/.test(raw) || /drop|\bdr\b/.test(n)) return 'drop';
  return 'distribution';
}

function parseCoordString(value) {
  if (!value) return null;
  const parts = String(value).trim().split(/\s+/)[0].split(',');
  if (parts.length < 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function parseCoordPath(value) {
  if (!value) return [];
  return String(value)
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const parts = tuple.split(',');
      const lng = Number(parts[0]);
      const lat = Number(parts[1]);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
    })
    .filter(Boolean);
}

function collectPlacemarks(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectPlacemarks(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (node.Placemark) {
    const list = Array.isArray(node.Placemark) ? node.Placemark : [node.Placemark];
    for (const p of list) if (p && typeof p === 'object') out.push(p);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'Placemark') continue;
    if (value && typeof value === 'object') collectPlacemarks(value, out);
  }
  return out;
}

function extendedDataOf(placemark) {
  const out = {};
  const ext = placemark.ExtendedData;
  if (!ext) return out;
  const dataList = ext.Data ? (Array.isArray(ext.Data) ? ext.Data : [ext.Data]) : [];
  for (const d of dataList) {
    if (!d || typeof d !== 'object') continue;
    const key = d['@_name'] || d.name;
    const value = d.value?.value ?? d.value ?? '';
    if (key) out[String(key)] = String(value);
  }
  const schema = ext.SchemaData;
  if (schema) {
    const simple = schema.SimpleData ? (Array.isArray(schema.SimpleData) ? schema.SimpleData : [schema.SimpleData]) : [];
    for (const d of simple) {
      if (d?.['@_name']) out[d['@_name']] = String(d.value ?? '');
    }
  }
  return out;
}

function geometryOf(placemark) {
  const points = [];
  const lines = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (obj.Point) {
      const p = parseCoordString(obj.Point.coordinates?.value ?? obj.Point.coordinates);
      if (p) points.push(p);
    }
    if (obj.LineString) {
      const path = parseCoordPath(obj.LineString.coordinates?.value ?? obj.LineString.coordinates);
      if (path.length > 1) lines.push(path);
    }
    if (obj.Polygon) {
      const outer = obj.Polygon.outerBoundaryIs?.LinearRing?.coordinates;
      const path = parseCoordPath(outer?.value ?? outer);
      if (path.length > 1) lines.push(path);
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !['Point', 'LineString', 'Polygon', 'coordinates'].includes(value)) {
        walk(value);
      }
    }
  };
  walk(placemark);
  return { points, lines };
}

function parseKml(xml, warnings) {
  let doc;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      trimValues: true,
      parseTagValue: false,
      cdataPropName: '__cdata',
    });
    doc = parser.parse(xml);
  } catch (err) {
    throw httpError(400, `KML tidak dapat dibaca: ${err.message}`);
  }
  const placemarks = collectPlacemarks(doc);
  const nodes = [];
  const cables = [];
  for (const pm of placemarks) {
    const name = cleanText(
      typeof pm.name === 'object' ? pm.name?.__cdata || pm.name?.value || '' : pm.name,
      160
    );
    const description = stripTags(
      typeof pm.description === 'object'
        ? pm.description?.__cdata || pm.description?.value || ''
        : pm.description
    ).slice(0, 800);
    const ext = extendedDataOf(pm);
    const style = String(pm.styleUrl || '').toLowerCase();
    const { points, lines } = geometryOf(pm);
    for (const coord of points) {
      nodes.push({
        name: name || ext.name || `Imported Node ${nodes.length + 1}`,
        type: inferNodeType(ext.type || ext.nodeType || ext.kind || style, name),
        lat: coord[0],
        lng: coord[1],
        status: ext.status || 'planned',
        code: ext.code || '',
        address: ext.address || '',
        serial: ext.serial || ext.onuSerial || '',
        notes: description || ext.notes || 'Import KML/GeoJSON',
        properties: ext,
      });
    }
    for (const path of lines) {
      cables.push({
        name: name || ext.name || `Imported Cable ${cables.length + 1}`,
        type: inferCableType(ext.type || ext.cableType || style, name),
        path,
        status: ext.status === 'active' ? 'active' : 'planned',
        color: /^#[0-9a-f]{6}$/i.test(ext.color || '') ? ext.color : COLORS[inferCableType(ext.type || ext.cableType, name)],
        fiberCount: Number(ext.fiberCount || ext.fibers) || (inferCableType(ext.type, name) === 'drop' ? 1 : 12),
        notes: description || ext.notes || 'Import KML/GeoJSON',
        fromName: ext.from || ext.fromNode || '',
        toName: ext.to || ext.toNode || '',
      });
    }
    if (!points.length && !lines.length) {
      warnings.push(`Placemark "${name}" tidak memiliki geometri Point/LineString dan dilewati.`);
    }
  }
  return { nodes, cables };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((values) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });
}

function parseGeoJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw httpError(400, `GeoJSON tidak valid: ${err.message}`);
  }
  const features = data.type === 'FeatureCollection' ? data.features : [data];
  const nodes = [];
  const cables = [];
  for (const feature of features || []) {
    if (!feature?.geometry) continue;
    const props = feature.properties || {};
    const name = cleanText(props.name || props.Nama || feature.id, 160);
    const type = inferNodeType(props.type || props.nodeType || props.kind, name);
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      nodes.push({
        name: name || `Imported Node ${nodes.length + 1}`,
        type,
        lat,
        lng,
        status: props.status || 'planned',
        code: props.code || '',
        address: props.address || '',
        serial: props.serial || '',
        notes: props.notes || props.description || 'Import GeoJSON',
        properties: props,
      });
    } else if (feature.geometry.type === 'LineString') {
      const path = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      if (path.length < 2) continue;
      const cableType = inferCableType(props.type || props.cableType, name);
      cables.push({
        name: name || `Imported Cable ${cables.length + 1}`,
        type: cableType,
        path,
        status: props.status === 'active' ? 'active' : 'planned',
        color: COLORS[cableType],
        fiberCount: Number(props.fiberCount) || 12,
        notes: props.notes || props.description || 'Import GeoJSON',
        fromName: props.from || '',
        toName: props.to || '',
      });
    }
  }
  return { nodes, cables };
}

function csvToNodes(rows) {
  return rows
    .map((r, i) => {
      const lat = Number(r.lat ?? r.latitude ?? r.y);
      const lng = Number(r.lng ?? r.lon ?? r.longitude ?? r.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const name = r.name || r.nama || r.code || `Imported Node ${i + 1}`;
      return {
        name: cleanText(name, 160),
        type: inferNodeType(r.type || r.tipe, name),
        lat,
        lng,
        status: r.status || 'planned',
        code: r.code || '',
        address: r.address || r.alamat || '',
        serial: r.serial || r.sn || '',
        notes: r.notes || r.keterangan || 'Import CSV',
        properties: r,
      };
    })
    .filter(Boolean);
}

async function parseUpload(file, warnings) {
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  if (ext === 'kmz') {
    const zip = await JSZip.loadAsync(file.buffer);
    const names = Object.keys(zip.files).filter((n) => /\.kml$/i.test(n));
    if (!names.length) throw httpError(400, 'KMZ tidak memuat file KML.');
    const preferred = names.find((n) => /doc\.kml$/i.test(n)) || names[0];
    const xml = await zip.files[preferred].async('string');
    return parseKml(xml, warnings);
  }
  const text = file.buffer.toString('utf8');
  if (ext === 'kml') return parseKml(text, warnings);
  if (ext === 'csv') {
    const rows = parseCsv(text);
    if (!rows.length) throw httpError(400, 'CSV kosong atau header tidak dikenali.');
    return { nodes: csvToNodes(rows), cables: [] };
  }
  if (ext === 'geojson' || ext === 'json') {
    const trimmed = text.trim();
    if (trimmed.startsWith('<')) return parseKml(trimmed, warnings);
    return parseGeoJSON(trimmed);
  }
  throw httpError(400, 'Format file tidak didukung.');
}

function findEndpoint(db, projectId, name, point) {
  if (name) {
    const byName = db.nodes.find(
      (n) =>
        n.projectId === projectId &&
        (n.name.toLowerCase() === String(name).toLowerCase() || n.code === name)
    );
    if (byName) return byName;
  }
  let best = null;
  for (const node of db.nodes.filter((n) => n.projectId === projectId)) {
    const d = haversine(point, [node.lat, node.lng]);
    if (d < 80 && (!best || d < best.d)) best = { node, d };
  }
  return best?.node || null;
}

router.post(
  '/io/import',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, 'File belum dipilih.');
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const dryRun = String(req.body.dryRun) === '1' || req.body.dryRun === true;
    const warnings = [];
    const parsed = await parseUpload(req.file, warnings);
    const preview = {
      format: (req.file.originalname.split('.').pop() || '').toUpperCase(),
      fileName: req.file.originalname,
      nodeCount: parsed.nodes.length,
      cableCount: parsed.cables.length,
      nodes: parsed.nodes.slice(0, 25),
      cables: parsed.cables.slice(0, 25).map((c) => ({
        ...c,
        lengthM: Math.round(pathLength(c.path)),
      })),
      warnings,
    };
    if (dryRun) {
      res.json({ dryRun: true, preview, message: 'Pratinjau import siap.' });
      return;
    }
    const license = licenseStatus(db.license, db.nodes.length);
    const capacity = Math.max(0, (license.maxNodes || 0) - db.nodes.length);
    const createdNodes = [];
    const createdCables = [];
    const now = new Date().toISOString();
    let skippedNodes = 0;
    for (const n of parsed.nodes) {
      if (createdNodes.length >= capacity) {
        skippedNodes += 1;
        continue;
      }
      const node = {
        id: uid('nd'),
        projectId: project.id,
        type: NODE_TYPES.includes(n.type) ? n.type : 'odp',
        name: n.name || `Imported Node ${createdNodes.length + 1}`,
        code: cleanText(n.code, 48) || `IMP-${createdNodes.length + 1}`,
        lat: Number(n.lat),
        lng: Number(n.lng),
        status: ['online', 'offline', 'warning', 'critical', 'maintenance', 'planned'].includes(n.status)
          ? n.status
          : 'planned',
        parentId: null,
        address: cleanText(n.address, 200),
        notes: cleanText(n.notes, 1000),
        vendor: '',
        model: '',
        serial: cleanText(n.serial, 80),
        capacity: 0,
        usedPorts: 0,
        genieacsSerial: '',
        oltId: '',
        properties: { importSource: req.file.originalname },
        createdAt: now,
        updatedAt: now,
      };
      db.nodes.push(node);
      createdNodes.push(node);
    }
    for (const c of parsed.cables) {
      if (!Array.isArray(c.path) || c.path.length < 2) continue;
      const from = findEndpoint(db, project.id, c.fromName, c.path[0]);
      const to = findEndpoint(db, project.id, c.toName, c.path[c.path.length - 1]);
      const cable = {
        id: uid('cb'),
        projectId: project.id,
        name: c.name || `Imported Cable ${createdCables.length + 1}`,
        code: `IMP-${createdCables.length + 1}`,
        type: CABLE_TYPES.includes(c.type) ? c.type : 'distribution',
        fromNodeId: from?.id || null,
        toNodeId: to?.id || null,
        path: c.path.map(([lat, lng]) => [Number(lat.toFixed(7)), Number(lng.toFixed(7))]),
        color: c.color || COLORS[c.type] || COLORS.distribution,
        animation: { type: 'flow', speed: 1, reverse: false },
        status: c.status === 'active' ? 'active' : 'planned',
        fiberCount: Number(c.fiberCount) || 12,
        usedFibers: 0,
        lengthM: Math.round(pathLength(c.path)),
        notes: c.notes || '',
        createdAt: now,
        updatedAt: now,
      };
      db.cables.push(cable);
      createdCables.push(cable);
    }
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'io.import',
      detail: `Import ${req.file.originalname}: ${createdNodes.length} node, ${createdCables.length} kabel${skippedNodes ? `, ${skippedNodes} node dilewati (kuota)` : ''}.`,
    });
    save();
    emitEvent('import', {
      projectId: project.id,
      actorId: req.user.id,
      nodes: createdNodes.length,
      cables: createdCables.length,
    });
    res.status(201).json({
      ok: true,
      preview,
      created: { nodes: createdNodes.length, cables: createdCables.length, skippedNodes },
      message: `Import selesai: ${createdNodes.length} node dan ${createdCables.length} kabel ditambahkan.${skippedNodes ? ` ${skippedNodes} node dilewati karena kuota lisensi.` : ''}`,
    });
  })
);

function kmlColor(hex) {
  const h = String(hex || '#22d3ee').replace('#', '');
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `ff${b}${g}${r}`.toLowerCase();
}

function buildKml(db, project) {
  const nodes = db.nodes.filter((n) => n.projectId === project.id);
  const cables = db.cables.filter((c) => c.projectId === project.id);
  const styles = CABLE_TYPES.map(
    (type) => `<Style id="cable-${type}">
      <LineStyle><color>${kmlColor(COLORS[type])}</color><width>${type === 'backbone' ? 5 : type === 'feeder' ? 4 : 2}</width></LineStyle>
    </Style>`
  ).join('\n');
  const nodePlacemarks = nodes
    .map(
      (n) => `<Placemark>
    <name>${xmlEscape(n.name)}</name>
    <description>${xmlEscape(
      [n.code, n.type.toUpperCase(), n.status, n.address, n.notes].filter(Boolean).join(' • ')
    )}</description>
    <ExtendedData>
      <Data name="type"><value>${xmlEscape(n.type)}</value></Data>
      <Data name="code"><value>${xmlEscape(n.code)}</value></Data>
      <Data name="status"><value>${xmlEscape(n.status)}</value></Data>
      <Data name="serial"><value>${xmlEscape(n.serial)}</value></Data>
      <Data name="address"><value>${xmlEscape(n.address)}</value></Data>
      <Data name="id"><value>${xmlEscape(n.id)}</value></Data>
    </ExtendedData>
    <Point><coordinates>${Number(n.lng).toFixed(7)},${Number(n.lat).toFixed(7)},0</coordinates></Point>
  </Placemark>`
    )
    .join('\n');
  const cablePlacemarks = cables
    .map((c) => {
      const from = nodes.find((n) => n.id === c.fromNodeId);
      const to = nodes.find((n) => n.id === c.toNodeId);
      return `<Placemark>
    <name>${xmlEscape(c.name)}</name>
    <description>${xmlEscape(
      `${c.type} • ${(Number(c.lengthM) / 1000).toFixed(2)} km • ${c.status} • ${c.fiberCount} core`
    )}</description>
    <styleUrl>#cable-${xmlEscape(c.type)}</styleUrl>
    <ExtendedData>
      <Data name="type"><value>${xmlEscape(c.type)}</value></Data>
      <Data name="cableType"><value>${xmlEscape(c.type)}</value></Data>
      <Data name="status"><value>${xmlEscape(c.status)}</value></Data>
      <Data name="color"><value>${xmlEscape(c.color)}</value></Data>
      <Data name="fiberCount"><value>${Number(c.fiberCount) || 0}</value></Data>
      <Data name="from"><value>${xmlEscape(from?.name || '')}</value></Data>
      <Data name="to"><value>${xmlEscape(to?.name || '')}</value></Data>
      <Data name="code"><value>${xmlEscape(c.code)}</value></Data>
    </ExtendedData>
    <LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>
      <coordinates>${c.path.map(([lat, lng]) => `${Number(lng).toFixed(7)},${Number(lat).toFixed(7)},0`).join(' ')}</coordinates>
    </LineString>
  </Placemark>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${xmlEscape(project.name)} — lintasJB NMS</name>
  <description>${xmlEscape(project.description || 'Export peta jaringan FTTH lintasJB NMS')}</description>
  ${styles}
  <Folder><name>Network Nodes (${nodes.length})</name>
${nodePlacemarks}
  </Folder>
  <Folder><name>Fiber Cables (${cables.length})</name>
${cablePlacemarks}
  </Folder>
</Document>
</kml>`;
}

function buildGeoJSON(db, project) {
  const nodes = db.nodes.filter((n) => n.projectId === project.id);
  const cables = db.cables.filter((c) => c.projectId === project.id);
  const features = [
    ...nodes.map((n) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
      properties: {
        kind: 'node',
        id: n.id,
        name: n.name,
        type: n.type,
        code: n.code,
        status: n.status,
        address: n.address,
        serial: n.serial,
        vendor: n.vendor,
        model: n.model,
      },
    })),
    ...cables.map((c) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: c.path.map(([lat, lng]) => [lng, lat]) },
      properties: {
        kind: 'cable',
        id: c.id,
        name: c.name,
        type: c.type,
        code: c.code,
        status: c.status,
        color: c.color,
        fiberCount: c.fiberCount,
        lengthM: c.lengthM,
        from: db.nodes.find((n) => n.id === c.fromNodeId)?.name || '',
        to: db.nodes.find((n) => n.id === c.toNodeId)?.name || '',
      },
    })),
  ];
  return {
    type: 'FeatureCollection',
    name: project.name,
    features,
  };
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(db, project, layer) {
  if (layer === 'cables') {
    const cables = db.cables.filter((c) => c.projectId === project.id);
    const header = 'name,code,type,status,color,fiberCount,usedFibers,lengthM,from,to,path';
    const rows = cables.map((c) => {
      const from = db.nodes.find((n) => n.id === c.fromNodeId)?.name || '';
      const to = db.nodes.find((n) => n.id === c.toNodeId)?.name || '';
      return [
        c.name,
        c.code,
        c.type,
        c.status,
        c.color,
        c.fiberCount,
        c.usedFibers,
        c.lengthM,
        from,
        to,
        c.path.map((p) => p.join(' ')).join('|'),
      ]
        .map(csvEscape)
        .join(',');
    });
    return `${header}\n${rows.join('\n')}`;
  }
  const nodes = db.nodes.filter((n) => n.projectId === project.id);
  const header = 'name,code,type,status,lat,lng,address,serial,vendor,model,genieacsSerial';
  const rows = nodes.map((n) =>
    [
      n.name,
      n.code,
      n.type,
      n.status,
      n.lat,
      n.lng,
      n.address,
      n.serial,
      n.vendor,
      n.model,
      n.genieacsSerial,
    ]
      .map(csvEscape)
      .join(',')
  );
  return `${header}\n${rows.join('\n')}`;
}

router.get(
  '/io/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const format = String(req.query.format || 'kml').toLowerCase();
    const safeName = project.code || project.name.replace(/[^a-z0-9-]+/gi, '-');
    if (format === 'kml') {
      const kml = buildKml(db, project);
      res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.kml"`);
      res.send(kml);
    } else if (format === 'kmz') {
      const kml = buildKml(db, project);
      const zip = new JSZip();
      zip.file('doc.kml', kml);
      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/vnd.google-earth.kmz');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.kmz"`);
      res.send(buffer);
    } else if (format === 'geojson' || format === 'json') {
      const data = buildGeoJSON(db, project);
      res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.geojson"`);
      res.send(JSON.stringify(data, null, 2));
    } else if (format === 'csv') {
      const layer = req.query.layer === 'cables' ? 'cables' : 'nodes';
      const csv = buildCsv(db, project, layer);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}-${layer}.csv"`);
      res.send(csv);
    } else {
      throw httpError(400, 'Format export harus kml, kmz, geojson, atau csv.');
    }
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'io.export',
      detail: `Export project ${project.name} sebagai ${format.toUpperCase()}.`,
    });
    save();
  })
);

router.get(
  '/io/template',
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = String(req.query.format || 'csv');
    if (type === 'csv') {
      const header =
        'name,code,type,status,lat,lng,address,serial,vendor,model,genieacsSerial\n' +
        'ODP Contoh 01,ODP-CONTOH,odp,online,-8.168900,113.702000,Jl. Contoh No.1,,,,\n' +
        'ONT Contoh 01,ONT-CONTOH,ont,online,-8.169500,113.703000,Jl. Contoh No.2,8812A1B2C3D4,ZTE,F609,8812A1B2C3D4';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="lintasjb-node-template.csv"');
      res.send(header);
    } else {
      throw httpError(400, 'Template tersedia untuk format csv.');
    }
  })
);

router.get(
  '/io/history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const projectId = String(req.query.projectId || '');
    const allowedIds = new Set(visibleProjects(db, req.user).map((p) => p.id));
    const items = db.activity
      .filter((a) => a.action.startsWith('io.'))
      .filter((a) => {
        if (a.userId === req.user.id) return true;
        if (!a.projectId) return req.user.role === 'superadmin';
        if (!allowedIds.has(a.projectId)) return false;
        return projectId ? a.projectId === projectId : true;
      })
      .slice(0, 60);
    res.json({ history: items });
  })
);

router.get(
  '/io/meta',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      importFormats: ['KML', 'KMZ', 'GeoJSON', 'CSV'],
      exportFormats: ['KML', 'KMZ', 'GeoJSON', 'CSV'],
      basemaps: BASEMAPS,
    });
  })
);

export default router;
