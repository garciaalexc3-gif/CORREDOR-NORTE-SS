export const number = (value, decimals = 0) => value != null && value !== "" && Number.isFinite(Number(value))
  ? new Intl.NumberFormat("es-SV", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(Number(value)) : "—";
export const money = (value, decimals = 2) => value != null && Number.isFinite(Number(value))
  ? new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD", maximumFractionDigits: decimals }).format(Number(value)) : "—";
export const hectares = (value) => value == null ? "—" : `${number(Number(value) / 10000, 2)} ha`;
export const pk = (value) => value != null && Number.isFinite(Number(value))
  ? `${Math.floor(Math.round(Number(value)) / 1000)}+${String(Math.round(Number(value)) % 1000).padStart(3, "0")}` : "—";
export const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
export const sumKnown = (rows, field) => {
  const values = rows.map((row) => row[field]).filter((value) => value != null && Number.isFinite(Number(value)));
  return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
};
export const median = (values) => {
  const sorted = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const shortUse = (value = "") => ({
  "RURAL INDUSTRIAL LOGISTICA": "Industrial y logística rural",
  "RURAL COMERCIAL": "Comercial rural",
  "RURAL MIXTO (COMERCIO INFORMAL-HAB INFORMAL-BALDIO)": "Mixto rural",
  "RURAL AGRICOLA - GANADERO -PROTECCIÓN": "Agrícola, ganadero y protección",
  "RURAL HABITACIONAL": "Habitacional rural",
  "URBANO HABITACIONAL": "Habitacional urbano",
  "URBANO MIXTO (COMERCIAL-HABITACIONAL-PREDIO)": "Mixto urbano",
}[value] ?? value);
export function groupRows(rows, key, field) {
  const groups = new Map();
  rows.forEach((row) => {
    const category = row[key] || "Sin clasificación";
    groups.set(category, (groups.get(category) || 0) + (field ? Number(row[field]) || 0 : 1));
  });
  return [...groups].map(([categoria, valor]) => ({ categoria, etiqueta: shortUse(categoria), valor }))
    .sort((a, b) => b.valor - a.valor);
}
export function aggregateNested(rows, field) {
  return groupRows(rows.flatMap((row) => row[field] || []), "categoria", "area_m2");
}
export function geometryOf(row) {
  const geometry = row?.geometry;
  if (!geometry) return null;
  if (typeof geometry === "object") return geometry;
  try { return JSON.parse(geometry); } catch { return null; }
}
export function pointsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(pointsOf);
  const visit = (coordinate) => typeof coordinate?.[0] === "number" ? [coordinate] : (coordinate || []).flatMap(visit);
  return visit(geometry.coordinates);
}
export function boundsOf(rows, fallback = [0, 0, 1000, 1000]) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  rows.forEach((row) => pointsOf(geometryOf(row)).forEach(([x, y]) => {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }));
  return bounds.every(Number.isFinite) ? bounds : fallback;
}
export function pathOf(geometry) {
  if (!geometry) return "";
  const line = (coordinates, close = false) => coordinates.map(([x, y], i) => `${i ? "L" : "M"}${x},${-y}`).join(" ") + (close ? " Z" : "");
  if (geometry.type === "Polygon") return geometry.coordinates.map((ring) => line(ring, true)).join(" ");
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.map((ring) => line(ring, true))).join(" ");
  if (geometry.type === "LineString") return line(geometry.coordinates);
  if (geometry.type === "MultiLineString") return geometry.coordinates.map((coordinates) => line(coordinates)).join(" ");
  if (geometry.type === "GeometryCollection") return geometry.geometries.map(pathOf).join(" ");
  return "";
}
export function paddedView(bounds, aspect = 1.48, minimumSpan = 1200) {
  const [x1, y1, x2, y2] = bounds;
  let width = Math.max(minimumSpan, x2 - x1) * 1.12;
  let height = Math.max(minimumSpan, y2 - y1) * 1.12;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  return { x: (x1 + x2) / 2 - width / 2, y: -(y1 + y2) / 2 - height / 2, width, height };
}
