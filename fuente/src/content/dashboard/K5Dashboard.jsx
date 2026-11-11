import React, { useEffect, useMemo, useRef, useState } from "react";
import { DataComponent, DataTable, Dialog, Dropdown, EvidenceChart, Filters, MetricCard,
  SegmentedControl, SortableItem, SortableRegion, useDashboardTabs, useDataApp } from "../../data-app-public.jsx";
import { aggregateNested, boundsOf, geometryOf, groupRows, hectares, median, money, number,
  paddedView, pathOf, pk, shortUse, sum, sumKnown } from "./k5-model.js";
import "./k5-dashboard.css";
import moptLogo from "../assets/corredor-mopt-gobierno.png";
import contractaLogo from "../assets/corredor-contracta.png";

const tabs = [
  { id: "territorio", label: "Síntesis territorial" }, { id: "mercado", label: "Mercado" },
  { id: "equipamientos", label: "Equipamientos" }, { id: "registros", label: "Registros" },
  { id: "cobertura", label: "Cobertura y fuentes" },
];
const tabGuides = {
  territorio: "Lectura del derecho de vía, el inventario predial y los usos del suelo.",
  mercado: "Comparables, valores unitarios y localización de la evidencia de mercado.",
  equipamientos: "Disponibilidad del inventario de servicios y equipamientos del corredor.",
  registros: "Consulta las fichas, fotografías disponibles y ubicación de cada registro.",
  cobertura: "Revisa la cobertura geométrica, las fuentes y el alcance del estudio.",
};
const AlternativeContext = React.createContext(null);
const canonicalRows = (queryId, rows, queries) => {
  if (!queries?.[queryId]) return rows;
  const ids = new Set(rows.map((entry) => entry.id));
  return queries[queryId].rows.filter((entry) => ids.has(entry.id));
};
const alternativeEvidence = (queryId, rows, alternative, queries) => alternative ? {
  queryIds: [queryId, "alternativas"], sourceRowsByQuery: { [queryId]: canonicalRows(queryId, rows, queries), alternativas: [alternative] },
} : { sourceRows: canonicalRows(queryId, rows, queries) };
const fallbackUses = { "Sin clasificación": "#eeeeea" };
const defaultPoints = { comparables: "#bd7853", "Centros escolares": "#61879a", Iglesias: "#a18b79",
  "Infraestructura pública relevante": "#8d9b6b", "Otros equipamientos": "#aaa1b4" };
const dateText = (value) => value && Number.isFinite(Date.parse(String(value).slice(0, 10))) ? new Intl.DateTimeFormat("es-SV", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—";
const isAerial = (row) => /aerea/i.test(row.imagen_tipo || "");
const sourceLabel = (value) => ({ ESCRITURA: "Escritura", INTERNET: "Internet", MUNICIPAL: "Referencia municipal", "REFERENCIA MUNICIPAL": "Referencia municipal", "ROTULO/TELEFONO/VERBAL": "Rótulo, teléfono o verbal" }[value] || value || "Sin consignar");
const publicMethodText = (text) => text.replace(/valor_m2_comercializacion/g, "valor unitario de comercialización").replace(/precio_m2/g, "precio unitario ajustado");
const marketMeasures = { oferta: "Oferta", ajustado: "Ajustado", comercializacion: "Comercialización" };
const recordCode = (row) => row.parcela_codigo || row.codigo || String(row.id);
const hasLocation = (row) => Boolean(geometryOf(row));
const generatesRadius = (row) => row.genera_radio !== false && row.genera_radio !== 0 && row.genera_radio !== "0" && Number(row.radio_m) > 0;
const locationMethod = (row) => row.ubicacion_metodo || row.metodo_ubicacion || row.georreferenciacion_metodo || "";
const geographicLocation = (row) => row.latitud != null && row.longitud != null
  && Number.isFinite(Number(row.latitud)) && Number.isFinite(Number(row.longitud))
  && Math.abs(Number(row.latitud)) <= 90 && Math.abs(Number(row.longitud)) <= 180
  ? { latitude: Number(row.latitud), longitude: Number(row.longitud) } : null;
const locationSummary = (row) => hasLocation(row)
  ? `${row.pk_m != null || row.pk_desde_m != null ? `PK ${pk(row.pk_m ?? row.pk_desde_m)}` : row.tramos_fuente?.join(" / ") || row.tramo2500 || "Contorno GIS"}${row.lateral && row.lateral !== "Sin determinar" ? ` · ${row.lateral}` : ""}`
  : "Sin ubicación cartográfica";
const unitPrice = (row, measure) => measure === "oferta"
  ? (row.precio_venta != null && Number(row.base_area_m2) > 0 ? Number(row.precio_venta) / Number(row.base_area_m2) : null)
  : (measure === "comercializacion" ? row.valor_m2_comercializacion : row.precio_m2);
const flatChildren = (children) => React.Children.toArray(children).flatMap((child) =>
  React.isValidElement(child) && child.type === React.Fragment ? flatChildren(child.props.children) : [child]);

function Legend({ entries }) {
  return <div className="k5-legend" data-reviewed-rows>{entries.map(({ label, color, line }) =>
    <span key={label}><i style={{ "--legend-color": color }} data-line={line || undefined} />{label}</span>)}</div>;
}
function AlternativeSelector({ alternatives, value, onChange, queries, parcelas, tramoValue, filterValues }) {
  if (!alternatives.length) return null;
  const summaries = alternatives.map((entry) => {
    const indicators = (entry.indicadores_tramo || queries.indicadores_tramo?.rows || []).filter((row) => !row.alternativa || String(row.alternativa) === String(entry.id))
      .filter((row) => !tramoValue || tramoValue === "all" || String(row.tramo2500 ?? row.id) === String(tramoValue));
    const overrides = new Map((entry.parcelas_overrides || []).map((row) => [row.parcela_codigo, row]));
    const scoped = (queries.parcelas?.rows || parcelas).filter((row) => (!row.alternativa || String(row.alternativa) === String(entry.id))
      && (!tramoValue || tramoValue === "all" || (row.tramos_fuente || [row.tramo2500]).map(String).includes(String(tramoValue)))
      && (!filterValues?.uso_suelo || filterValues.uso_suelo === "all" || parcelUse(row) === filterValues.uso_suelo)
      && (!filterValues?.lateral || filterValues.lateral === "all" || row.lateral === filterValues.lateral))
      .map((row) => overrides.has(row.parcela_codigo) ? { ...row, ...overrides.get(row.parcela_codigo) } : row);
    return { id: String(entry.id), label: entry.label, descripcion: entry.descripcion,
      area_ddv_m2: sumKnown(indicators, "area_ddv_conocida_m2"), intersecciones: scoped.filter((row) => Number(tramoValue && tramoValue !== "all" ? row.area_ddv_por_tramo?.[tramoValue] : row.area_ddv_m2) > 0).length };
  });
  return <DataComponent id="k5-alternative-comparison" title="Alternativas del corredor" queryId="alternativas" queryIds={["alternativas", "parcelas", "indicadores_tramo"]}
    sourceRowsByQuery={{ alternativas: alternatives, parcelas: queries.parcelas?.rows || [], indicadores_tramo: queries.indicadores_tramo?.rows || [] }}
    displayRows={summaries} kind="custom" variant="plain" className="k5-alternatives-panel"
    description="Compara el DDV territorial y las parcelas del inventario. Las áreas sin cuantificar se conservan como ausentes.">
    <div className="k5-alternative-options" data-reviewed-rows>{summaries.map((entry) => <button key={entry.id} type="button" className={`k5-alternative-option ${entry.id === value ? "is-selected" : ""}`}
      aria-pressed={entry.id === value} aria-label={`Seleccionar ${entry.label}`} onClick={() => onChange(entry.id)}>
      <span className="k5-alternative-name"><i aria-hidden="true">{entry.id === value ? "✓" : entry.id}</i><span><strong>{entry.label}</strong><small>{entry.id === value ? "Alternativa seleccionada" : "Consultar alternativa"}</small></span></span>
      <span className="k5-alternative-stat"><b>{hectares(entry.area_ddv_m2)}</b><small>DDV conocido · {!tramoValue || tramoValue === "all" ? "corredor" : "tramo"}</small></span>
      <span className="k5-alternative-stat"><b>{number(entry.intersecciones)}</b><small>parcelas en selección</small></span>
    </button>)}</div>
    <p className="k5-alternative-help">DDV: derecho de vía · selección independiente por alternativa.</p>
  </DataComponent>;
}
function Composition({ rows, colors, unit = "registros", onSelect, canSelect = () => true, additive = true }) {
  const total = sum(rows, "valor");
  return <div className="k5-composition" data-reviewed-rows>
    {additive && <div className="k5-composition-ribbon" aria-hidden="true">{rows.map((r) => <span key={r.categoria} style={{ flex: r.valor, background: colors[r.categoria] || "#eeeeea" }} />)}</div>}
    <div className="k5-composition-list">{rows.map((r) => <button type="button" key={r.categoria} className="k5-composition-item" onClick={() => onSelect?.(r.categoria)} disabled={!onSelect || !canSelect(r.categoria)}
      aria-label={`${r.etiqueta}: ${number(unit === "ha" ? r.valor / 10000 : r.valor, unit === "ha" ? 2 : 0)} ${unit}`}>
      <i style={{ background: colors[r.categoria] || "#eeeeea" }} /><span><strong>{r.etiqueta}</strong>{additive && <small>{total ? number(r.valor / total * 100, 1) : 0}%</small>}</span>
      <b>{unit === "ha" ? number(r.valor / 10000, 2) : number(r.valor)}</b>
    </button>)}</div>
    {!rows.length && <p className="k5-empty">Sin registros para esta selección.</p>}
    <p className="k5-unit">{unit === "ha" ? additive ? "Superficie territorial en hectáreas" : "Superficies por categoría · no sumar como partición exclusiva" : `Distribución de ${unit}`}</p>
  </div>;
}
const parcelUse = (row) => row.uso_filtro || row.uso_suelo || "Sin clasificación";
const usePanelKey = (category) => {
  let hash = 5381;
  for (const character of category) hash = (hash * 33 ^ character.charCodeAt(0)) >>> 0;
  return hash.toString(36);
};
function ParcelUseInventory({ parcelas, colors, alternative, queries, selectedUse, onFilter, onSelect, scopeKey }) {
  const [expandedUse, setExpandedUse] = useState(null);
  const categories = groupRows(parcelas.map((row) => ({ uso_inventario: parcelUse(row) })), "uso_inventario");
  const total = parcelas.length;
  useEffect(() => {
    if (expandedUse && !categories.some((entry) => entry.categoria === expandedUse)) setExpandedUse(null);
  }, [expandedUse, categories.map((entry) => entry.categoria).join("|")]);
  return <DataComponent id="k5-use-composition" title="Uso normativo principal" queryId="parcelas" kind="custom" variant="card" className="k5-use-inventory"
    {...alternativeEvidence("parcelas", parcelas, alternative, queries)} displayRows={categories}
    description="Distribución del inventario de la selección actual. Despliega un uso para buscar sus parcelas y abrir una ficha con imagen disponible y ubicación. Filtrar mapa es una acción independiente; los conteos respetan la alternativa, el tramo, el lateral y el filtro de uso.">
    <div className="k5-use-overview" data-reviewed-rows><span><b>{number(total)}</b> parcelas</span><small>{number(categories.length)} usos en la selección</small></div>
    <div className="k5-composition-ribbon k5-use-ribbon" aria-hidden="true">{categories.map((entry) => <span key={entry.categoria} style={{ flex: entry.valor, background: colors[entry.categoria] || "#eeeeea" }} />)}</div>
    <p className="k5-use-guidance">Despliega una categoría para consultar sus parcelas. Se asigna el uso normativo de mayor área, según la fuente; no acredita uso físico actual.</p>
    <div className="k5-use-accordion" data-reviewed-rows>{categories.map((entry) => {
      const category = entry.categoria, panelKey = usePanelKey(category), expanded = expandedUse === category;
      const categoryRows = parcelas.filter((row) => parcelUse(row) === category);
      const filtered = selectedUse === category;
      return <section className={`k5-use-group ${expanded ? "is-expanded" : ""}`} key={category} style={{ "--use-color": colors[category] || "#eeeeea" }}>
        <button type="button" id={`k5-use-heading-${panelKey}`} className="k5-use-toggle" aria-expanded={expanded} aria-controls={`k5-use-panel-${panelKey}`}
          onClick={() => setExpandedUse(expanded ? null : category)} aria-label={`${expanded ? "Contraer" : "Desplegar"} ${entry.etiqueta}: ${number(entry.valor)} parcelas`}>
          <i className="k5-use-swatch" aria-hidden="true" /><span className="k5-use-name"><strong>{entry.etiqueta}</strong><small>{total ? number(entry.valor / total * 100, 1) : "0"}% de la selección{filtered ? " · Filtro activo" : ""}</small></span>
          <b className="k5-use-count">{number(entry.valor)}</b><span className="k5-use-chevron" aria-hidden="true">⌄</span>
        </button>
        {expanded && <div id={`k5-use-panel-${panelKey}`} className="k5-use-panel" role="region" aria-labelledby={`k5-use-heading-${panelKey}`}>
          <div className="k5-use-panel-actions"><span>Parcelas de este uso</span><button type="button" className="k5-use-map-filter" aria-pressed={filtered} onClick={() => onFilter(filtered ? "all" : category)}>{filtered ? "Quitar filtro del mapa" : "Filtrar mapa por este uso"}<span aria-hidden="true">↗</span></button></div>
          <RecordTable key={`${panelKey}:${scopeKey}`} id={`k5-use-parcels-${panelKey}`} title={`Parcelas · ${entry.etiqueta}`} queryId="parcelas" rows={categoryRows}
            columns={[parcelColumns[0], parcelColumns.find((column) => column.field === "area_ddv_m2")]} onSelect={onSelect} variant="plain" compact />
        </div>}
      </section>;
    })}</div>
    {!total && <p className="k5-empty">Sin parcelas para esta selección.</p>}
    <p className="k5-unit">Inventario predial · conteos según los filtros activos</p>
  </DataComponent>;
}
function RecordDetail({ selected, onClose, colors, mapProps, measure = "oferta" }) {
  const alternative = React.useContext(AlternativeContext)?.alternative;
  if (!selected) return null;
  const { row, type } = selected, parcel = type === "parcelas", comparable = type === "comparables";
  const title = recordCode(row), located = hasLocation(row), geographic = geographicLocation(row);
  return <Dialog open={Boolean(selected)} onClose={onClose} expanded title={title} className="k5-record-detail-dialog"><div className="k5-detail" data-reviewed-rows>
    <div className="k5-detail-heading"><div className="k5-record-kind"><i style={{ background: parcel ? colors.usos[row.uso_suelo] : comparable ? colors.puntos.comparables : colors.puntos[row.categoria] }} />{parcel ? "Parcela del inventario" : comparable ? "Comparable de mercado" : row.categoria}</div>
      {alternative && <span className="k5-detail-alternative">{alternative.label}</span>}</div>
    {row.nombre && <h3>{row.nombre}</h3>}<p className="k5-detail-use">{parcel || comparable ? shortUse(row.uso_suelo) || "Sin clasificación" : row.tipo}</p>
    <div className={`k5-detail-media ${row.foto ? "" : "k5-detail-media--no-image"}`}>
      {row.foto ? <figure className="k5-detail-figure"><img className="k5-detail-photo" src={row.foto} alt={`${isAerial(row) ? "Vista aérea" : "Fotografía"} de ${title}`} /><figcaption>{isAerial(row) ? "Vista aérea del registro" : "Fotografía del registro"}</figcaption></figure>
        : <p className="k5-detail-image-missing">Sin imagen disponible para este registro.</p>}
      <section className="k5-detail-location" aria-label={`Ubicación de ${title}`}>
        {located ? <TerritorialMap key={`${type}-${row.id}`} id={`k5-detail-location-${type}`} title={`Ubicación de ${title}`} {...mapProps} selected={selected} focusRecord={selected} compact
          initialLayers={{ parcelas: parcel, comparables: comparable, equipamientos: !parcel && !comparable, mag: false, radios: !parcel && !comparable }} />
          : <div className="k5-location-missing"><strong>Ubicación no disponible</strong><span>Este registro no tiene coordenadas o geometría utilizables para situarlo en el mapa.</span></div>}
        {geographic && <div className="k5-location-coordinates"><span>Latitud {number(geographic.latitude, 7)} · Longitud {number(geographic.longitude, 7)}</span>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${geographic.latitude},${geographic.longitude}`)}`} target="_blank" rel="noopener noreferrer">Abrir ubicación en Google Maps ↗</a></div>}
      </section>
    </div>
    <dl className="k5-detail-grid">
      {(row.pk_m != null || row.pk_desde_m != null) && <div><dt>{parcel ? "Progresiva del predio" : "Progresiva proyectada al eje"}</dt><dd>{pk(row.pk_m ?? row.pk_desde_m)}{parcel && row.pk_hasta_m != null ? ` – ${pk(row.pk_hasta_m)}` : ""}</dd></div>}
      {parcel && <><div><dt>Código catastral CNR</dt><dd>{row.codigo_cnr || "Sin consignar"}</dd></div><div><dt>Distrito</dt><dd>{row.distrito || "Sin consignar"}</dd></div><div><dt>Tramos de intersección</dt><dd>{row.tramos_fuente?.join(" · ") || "Sin consignar"}</dd></div>{row.lateral && row.lateral !== "Sin determinar" && <div><dt>Lateral</dt><dd>{row.lateral}</dd></div>}<div><dt>Área del predio</dt><dd>{number(row.area_parcela_m2, 2)} m²</dd></div><div><dt>Intersección con DDV</dt><dd>{number(row.area_ddv_m2, 2)} m²</dd></div><div><dt>Vínculo geométrico</dt><dd>{row.estado_geometria}</dd></div></>}
      {comparable && <><div><dt>{marketMeasures[measure]} / m²</dt><dd>{money(unitPrice(row, measure))}</dd></div><div><dt>Tipo de inmueble</dt><dd>{row.tipo_inmueble || "Sin consignar"}</dd></div><div><dt>Área de referencia</dt><dd>{number(row.base_area_m2, 2)} m² · {row.tipo_inmueble === "Terreno" ? "terreno" : "construcción"}</dd></div><div><dt>Precio total de fuente</dt><dd>{money(row.precio_venta, 0)}</dd></div><div><dt>Valor adoptado para adquisición</dt><dd>{row.precio_ajustado == null ? "Pendiente de valoración" : money(row.precio_ajustado, 0)}</dd></div><div><dt>Fuente</dt><dd>{sourceLabel(row.tipo_fuente)}</dd></div><div><dt>Fecha de consulta</dt><dd>{dateText(row.fecha_consulta || row.fecha)}</dd></div><div><dt>Fecha de publicación o precio</dt><dd>{dateText(row.fecha_publicacion || row.fecha_precio)}</dd></div></>}
      {!parcel && !comparable && <div><dt>Radio de referencia</dt><dd>{generatesRadius(row) ? `${number(row.radio_m)} m` : "Registro contextual · sin radio"}</dd></div>}
      {comparable && (row.naturaleza_precio || row.naturaleza_registro) && <div><dt>Naturaleza del precio</dt><dd>{row.naturaleza_precio || row.naturaleza_registro}</dd></div>}
      {comparable && row.base_area_tipo && <div><dt>Base del área de referencia</dt><dd>{row.base_area_tipo}</dd></div>}
      {comparable && row.es_referencia_municipal && <div><dt>Referencia municipal por zona</dt><dd>{money(row.valor_unitario_referencia_fuente)}/m²</dd></div>}
      {!parcel && row.lateral && row.lateral !== "Sin determinar" && <div><dt>Lateral respecto al eje</dt><dd>{row.lateral || "Sin determinar"}</dd></div>}
      <div><dt>Ubicación en mapa</dt><dd>{located ? parcel ? "Contorno del predio en el mapa de la ficha" : "Punto del registro en el mapa de la ficha" : "Sin coordenadas utilizables"}</dd></div>
      {locationMethod(row) && <div><dt>Método de ubicación</dt><dd>{locationMethod(row)}</dd></div>}
    </dl>
    {parcel && row.usos_normativos_fuente && <p className="k5-detail-callout"><strong>Usos normativos de la fuente:</strong> {row.usos_normativos_fuente}<br />{row.uso_clasificacion_metodo}</p>}
    {parcel && row.uso_actual_2014 && <p className="k5-detail-callout"><strong>Uso observado 2014:</strong> {row.uso_actual_2014}. La normativa y el uso observado corresponden a variables y fechas distintas.</p>}
    {comparable && row.tipo_inmueble !== "Terreno" && row.advertencia_ratio && <p className="k5-detail-callout">{row.advertencia_ratio}</p>}
    {comparable && row.observaciones && <p className="k5-detail-callout"><strong>Observaciones de la fuente:</strong> {row.observaciones}</p>}
    {comparable && row.url && <p className="k5-detail-callout"><a href={row.url} target="_blank" rel="noopener noreferrer">Consultar anuncio de la fuente ↗</a></p>}
    {row.es_referencia_municipal && <p className="k5-detail-callout">Referencia municipal por zona. No se interpreta como oferta de un terreno ni se incluye en la mediana del precio ajustado.</p>}
    {row.coordenada_derivada_parcela && <p className="k5-detail-callout">Ubicación referencial asignada a un punto interior del catastro. No corresponde a una coordenada observada en campo.</p>}
    {row.fecha_futura_fuente && <p className="k5-detail-callout k5-detail-callout--review">La fuente consigna una fecha futura: {dateText(row.fecha)}. Se conserva para revisión y no acredita una actualización del estudio en esa fecha.</p>}
  </div></Dialog>;
}

function TerritorialMap({ id, title, parcelas, comparables, equipamientos, cartografia, meta, onSelect, selected, sourceRowsByQuery, compact = false, initialLayers, focusRecord }) {
  const svgRef = useRef(null), drag = useRef(null), suppressClick = useRef(false);
  const [size, setSize] = useState({ width: 900, height: 500 });
  useEffect(() => {
    const element = svgRef.current;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const colors = meta.paleta || {}, uses = { ...fallbackUses, ...colors.usos }, points = { ...defaultPoints, ...colors.puntos };
  const satelliteAvailable = Boolean(meta.satelital?.imagen && meta.satelital?.extent);
  const hasMag = cartografia.some((entry) => entry.capa === "suelos_mag"), hasEquipment = equipamientos.length > 0, hasRadii = equipamientos.some(generatesRadius);
  const hasDdv = cartografia.some((entry) => ["corredor_ddv", "limites_ddv_fuente"].includes(entry.capa));
  const [layers, setLayers] = useState({ parcelas: true, mag: false, ddv: true, comparables: true, equipamientos: true, radios: false, satelital: satelliteAvailable && meta.satelital?.activo_inicial !== false, ...initialLayers });
  const [satelliteOpacity, setSatelliteOpacity] = useState(() => Math.max(.2, Math.min(.7, Number(meta.satelital?.opacidad) || .3)));
  const features = useMemo(() => cartografia.map((row) => ({ row, geometry: geometryOf(row), d: pathOf(geometryOf(row)) })), [cartografia]);
  const parcelPaths = useMemo(() => parcelas.filter((row) => row.geometry).map((row) => ({ row, d: pathOf(geometryOf(row)) })), [parcelas]);
  const bounds = useMemo(() => {
    const extent = boundsOf(focusRecord ? [focusRecord.row] : [...cartografia.filter((r) => r.capa === "tramos_2500"), ...parcelas, ...comparables, ...equipamientos], meta.extent);
    const influenceRows = (focusRecord ? focusRecord.type === "equipamientos" ? [focusRecord.row] : [] : equipamientos).filter(generatesRadius);
    if (layers.radios) influenceRows.forEach((row) => {
      const geometry = geometryOf(row);
      if (geometry?.type !== "Point") return;
      const [x, y] = geometry.coordinates, radius = Number(row.radio_m);
      extent[0] = Math.min(extent[0], x - radius); extent[1] = Math.min(extent[1], y - radius);
      extent[2] = Math.max(extent[2], x + radius); extent[3] = Math.max(extent[3], y + radius);
    });
    return extent;
  }, [cartografia, parcelas, comparables, equipamientos, meta.extent, layers.radios, focusRecord]);
  const fitted = useMemo(() => paddedView(bounds, size.width / size.height, focusRecord ? focusRecord.type === "parcelas" ? 30 : 250 : 1200), [bounds, size.width, size.height, focusRecord]);
  const [view, setView] = useState(fitted);
  const fittedKey = `${fitted.x},${fitted.y},${fitted.width},${fitted.height}`;
  useEffect(() => setView(fitted), [fittedKey]);
  const zoom = (factor, anchor) => setView((previous) => {
    const width = Math.max(focusRecord ? 10 : 120, Math.min(150000, previous.width * factor)), ratio = width / previous.width;
    const a = anchor || { x: previous.x + previous.width / 2, y: previous.y + previous.height / 2 };
    return { x: a.x - (a.x - previous.x) * ratio, y: a.y - (a.y - previous.y) * ratio, width, height: previous.height * ratio };
  });
  useEffect(() => {
    const element = svgRef.current;
    const handler = (event) => { event.preventDefault(); const point = element.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
      const matrix = element.getScreenCTM(); zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, matrix ? point.matrixTransform(matrix.inverse()) : undefined); };
    element.addEventListener("wheel", handler, { passive: false }); return () => element.removeEventListener("wheel", handler);
  }, []);
  const scale = Math.max(view.width / size.width, view.height / size.height), scaleMeters = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter((value) => value <= view.width / 4).at(-1) || 1;
  const toggle = (name) => setLayers((previous) => ({ ...previous, [name]: !previous[name] }));
  const polygon = (f, fill, stroke, cls) => <path key={f.row.id} d={f.d} fill={fill} stroke={stroke} className={cls} fillRule="evenodd" vectorEffect="non-scaling-stroke" />;
  const isSelected = (row) => selected?.row.id === row.id;
  const pointMarks = (rows, type) => rows.filter((r) => geometryOf(r)?.type === "Point").map((row) => {
    const [x, y] = geometryOf(row).coordinates, color = type === "comparables" ? points.comparables : points[row.categoria] || "#aaa1b4";
    return <g key={row.id} className="k5-map-point" role="button" tabIndex={0} aria-label={`${row.codigo}, ${row.nombre || shortUse(row.uso_suelo)}${row.pk_m == null ? "" : `, PK ${pk(row.pk_m)}`}`}
      onClick={() => { if (!suppressClick.current) onSelect({ type, row }); }} onKeyDown={(e) => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); onSelect({ type, row }); } }}>
      {isSelected(row) && <circle cx={x} cy={-y} r={scale * 13} fill="white" stroke="#163f4d" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {type === "comparables" ? <path d={`M${x},${-y - scale * 6}l${scale * 6},${scale * 6}l${-scale * 6},${scale * 6}l${-scale * 6},${-scale * 6}Z`} fill={color} stroke="#fff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /> : <circle cx={x} cy={-y} r={scale * 4.8} fill={color} stroke="#fff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
      <circle cx={x} cy={-y} r={scale * 10} fill="transparent" /><title>{row.codigo} · {row.nombre || shortUse(row.uso_suelo)}{row.pk_m == null ? "" : ` · PK ${pk(row.pk_m)}`}</title>
    </g>;
  });
  return <DataComponent id={id} title={title} queryId={focusRecord?.type || "parcelas"} queryIds={["parcelas", "comparables", "equipamientos", "cartografia", "metadatos", ...(sourceRowsByQuery.alternativas ? ["alternativas"] : [])]} kind="custom" displayRows={[]} sourceRowsByQuery={sourceRowsByQuery} variant="card" className="k5-map-card"
    description={focusRecord ? `Geometría del registro y cartografía de contexto, en ${meta.crs?.nombre || "el CRS de la fuente"}. Consulta el método de ubicación de la ficha. Encuadrar centra el registro.` : `Geometrías revisadas en ${meta.crs?.nombre || "el CRS de la fuente"}. DDV: derecho de vía. El uso normativo filtra las parcelas; las capas de contexto conservan el alcance del tramo.`}>
    <div className="k5-map-toolbar"><span className="k5-map-toolbar-label">Capas</span><div className="k5-map-layers" aria-label="Capas del mapa">{[["parcelas", "Parcelas"], ...(hasMag ? [["mag", "Capacidad MAG"]] : []), ...(hasDdv ? [["ddv", "DDV"]] : []), ...(comparables.length ? [["comparables", "Mercado"]] : []), ...(hasEquipment ? [["equipamientos", "Equipamientos"]] : []), ...(hasRadii ? [["radios", "Radios de fuente"]] : []), ...(satelliteAvailable ? [["satelital", "Satelital"]] : [])].map(([name, label]) => <label key={name}><input type="checkbox" checked={layers[name]} onChange={() => toggle(name)} /><span>{label}</span></label>)}</div>
      {satelliteAvailable && layers.satelital && <div className="k5-satellite-control"><label htmlFor={`${id}-satellite-opacity`}>Opacidad del satélite</label><input id={`${id}-satellite-opacity`} type="range" min="20" max="70" step="5" value={Math.round(satelliteOpacity * 100)} aria-valuetext={`${Math.round(satelliteOpacity * 100)}% de opacidad`} onChange={(event) => setSatelliteOpacity(Number(event.target.value) / 100)} /><output htmlFor={`${id}-satellite-opacity`}>{Math.round(satelliteOpacity * 100)}%</output></div>}
    </div>
    <div className={`k5-map ${compact ? "k5-map--compact" : ""}`} data-reviewed-rows>
      <svg ref={svgRef} className="k5-map-svg" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="img" aria-label={focusRecord ? `Mapa de ubicación de ${recordCode(focusRecord.row)}` : `Mapa geográfico de ${meta.titulo || "Corredor Norte"}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => { if (e.button !== 0) return; suppressClick.current = false; drag.current = { x: e.clientX, y: e.clientY, view }; }}
        onPointerMove={(e) => { if (!drag.current) return; if (Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) < 4 && !suppressClick.current) return;
          suppressClick.current = true; e.currentTarget.setPointerCapture(e.pointerId);
          const rect = e.currentTarget.getBoundingClientRect(); const ratio = Math.max(drag.current.view.width / rect.width, drag.current.view.height / rect.height);
          setView({ ...drag.current.view, x: drag.current.view.x - (e.clientX - drag.current.x) * ratio, y: drag.current.view.y - (e.clientY - drag.current.y) * ratio }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <defs><pattern id={`${id}-grid`} width="2500" height="2500" patternUnits="userSpaceOnUse"><path d="M 2500 0 L 0 0 0 2500" fill="none" stroke="#d1d4c7" strokeWidth=".45" vectorEffect="non-scaling-stroke" /></pattern></defs>
        <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={`url(#${id}-grid)`} />
        {!layers.satelital && meta.relieve?.imagen && meta.relieve?.extent && <image href={meta.relieve.imagen} x={meta.relieve.extent[0]} y={-meta.relieve.extent[3]} width={meta.relieve.extent[2] - meta.relieve.extent[0]} height={meta.relieve.extent[3] - meta.relieve.extent[1]} opacity={meta.relieve.opacidad || .24} preserveAspectRatio="none" />}
        {layers.satelital && satelliteAvailable && <image data-map-background="satelital" href={meta.satelital.imagen} x={meta.satelital.extent[0]} y={-meta.satelital.extent[3]} width={meta.satelital.extent[2] - meta.satelital.extent[0]} height={meta.satelital.extent[3] - meta.satelital.extent[1]} opacity={satelliteOpacity} preserveAspectRatio="none" />}
        {layers.mag && features.filter((f) => f.row.capa === "suelos_mag").map((f) => polygon(f, colors.mag?.[f.row.categoria] || "#eeeeea", "#9da68d", "k5-map-mag"))}
        {features.filter((f) => f.row.capa === "catastro_fuera_inventario").map((f) => polygon(f, "#e5e6dd", "#b8bcb0", "k5-map-cad"))}
        {layers.parcelas && parcelPaths.map(({ row, d }) => <path key={row.id} d={d} fill={uses[row.uso_suelo] || "#eeeeea"} stroke={isSelected(row) ? "#163f4d" : "#777f76"} strokeWidth={isSelected(row) ? "2.5" : ".6"} vectorEffect="non-scaling-stroke" className="k5-map-parcel" fillRule="evenodd" tabIndex={view.width < 10000 ? 0 : -1} role="button" aria-label={`${row.parcela_codigo}, ${shortUse(row.uso_suelo)}`} onClick={() => { if (!suppressClick.current) onSelect({ type: "parcelas", row }); }} onKeyDown={(e) => { if (e.key === "Enter") onSelect({ type: "parcelas", row }); }}><title>{row.parcela_codigo} · {shortUse(row.uso_suelo)}</title></path>)}
        {layers.ddv && features.filter((f) => f.row.capa === "corredor_ddv").map((f) => polygon(f, "#e39b4f", "#995d28", "k5-map-ddv-fill"))}
        {layers.ddv && features.filter((f) => f.row.capa === "limites_ddv_fuente").map((f) => polygon(f, "none", "#0047cc", "k5-map-ddv-line"))}
        {features.filter((f) => f.row.capa === "eje").map((f) => polygon(f, "none", "#163f4d", "k5-map-axis"))}
        {layers.ddv && features.filter((f) => f.row.capa === "tramos_no_cuantificables").map((f) => polygon(f, "none", "#995d28", "k5-map-gap"))}
        {layers.radios && (focusRecord ? focusRecord.type === "equipamientos" ? [focusRecord.row] : [] : equipamientos).filter((r) => generatesRadius(r) && geometryOf(r)?.type === "Point").map((r) => { const [x, y] = geometryOf(r).coordinates; return <circle key={`r-${r.id}`} cx={x} cy={-y} r={Number(r.radio_m)} data-influence-radius-m={Number(r.radio_m)} fill="none" stroke={points[r.categoria] || "#8d9b6b"} strokeOpacity=".6" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />; })}
        {features.filter((f) => f.row.capa === "progresivas_500" && Math.round(f.row.pk_desde_m ?? 0) % (view.width > 15000 ? 5000 : view.width > 6000 ? 2500 : 500) === 0).map((f) => { if (f.geometry?.type !== "Point") return null; const [x, y] = f.geometry.coordinates; return <g key={f.row.id} className="k5-map-pk"><circle cx={x} cy={-y} r={scale * 2.5} /><text x={x + scale * 8} y={-y - scale * 6} fontSize={scale * 12}>{f.row.nombre || pk(f.row.pk_desde_m)}</text></g>; })}
        {layers.comparables && pointMarks(comparables, "comparables")}{layers.equipamientos && pointMarks(equipamientos, "equipamientos")}
      </svg>
      <div className="k5-map-navigation"><button type="button" onClick={() => zoom(1 / 1.5)} aria-label="Acercar mapa">+</button><button type="button" onClick={() => zoom(1.5)} aria-label="Alejar mapa">−</button><button type="button" className="k5-map-fit" onClick={() => setView(fitted)}>Encuadrar</button></div>
      <div className="k5-map-north" aria-label="Norte">N<span>↑</span></div>
      <div className="k5-map-scale"><span style={{ width: `${scaleMeters / scale}px` }} />{scaleMeters < 1000 ? `${number(scaleMeters)} m` : `${number(scaleMeters / 1000)} km`}</div>
      <span className="k5-map-crs">{meta.crs?.nombre || "CRS de fuente"} · metros</span>
    </div>
    <Legend entries={[{ label: "Eje", color: "#163f4d", line: "solid" }, ...(layers.ddv ? [{ label: "Límite DDV", color: "#0047cc", line: "dashed" }, { label: "Afectación DDV", color: "#e39b4f" }] : []), ...(layers.comparables ? [{ label: "Comparable", color: points.comparables }] : []), ...(layers.equipamientos && hasEquipment ? [{ label: "Centro escolar", color: points["Centros escolares"] }, { label: "Iglesia", color: points.Iglesias }, { label: "Infraestructura", color: points["Infraestructura pública relevante"] }, { label: "Otros", color: points["Otros equipamientos"] }] : []), ...(layers.radios && hasRadii ? [{ label: "Radio de fuente", color: "#61879a", line: "dashed" }] : [])]} />
    {(layers.mag || layers.parcelas) && <div className="k5-map-thematic-legends">{layers.mag && hasMag && <details><summary>Clases de capacidad MAG</summary><Legend entries={Object.entries(colors.mag || {}).map(([label, color]) => ({ label, color }))} /></details>}{layers.parcelas && <details><summary>Usos del suelo</summary><Legend entries={Object.entries(uses).map(([label, color]) => ({ label: shortUse(label), color }))} /></details>}</div>}
    {!focusRecord && <span className="k5-map-guidance">Selecciona un predio o un punto para consultar su ficha. Arrastra el mapa para desplazarte.</span>}
    {(layers.satelital ? meta.satelital?.atribucion : meta.relieve?.atribucion) && <span className="k5-map-attribution">{layers.satelital ? meta.satelital.atribucion : meta.relieve.atribucion}</span>}
  </DataComponent>;
}

const parcelColumns = [
  { field: "parcela_codigo", label: "Parcela" }, { field: "uso_suelo", label: "Uso del suelo", renderCell: (v) => shortUse(v) || "Sin clasificación" },
  { field: "codigo_cnr", label: "Código CNR" }, { field: "distrito", label: "Distrito" },
  { field: "area_parcela_m2", label: "Área predio · m²", renderCell: (v) => number(v, 2) },
  { field: "area_ddv_m2", label: "Intersección DDV · m²", renderCell: (v) => number(v, 2) },
];
const marketColumns = [
  { field: "codigo", label: "Comparable" },
  { field: "tipo_inmueble", label: "Tipo de inmueble" },
  { field: "base_area_m2", label: "Área de referencia · m²", renderCell: (v) => number(v, 2) },
  { field: "precio_m2", label: "Oferta · US$/m²", renderCell: (v) => money(v) },
  { field: "precio_venta", label: "Precio de oferta · US$", renderCell: (v) => money(v, 0) },
  { field: "tipo_fuente", label: "Fuente", renderCell: (v) => sourceLabel(v) },
  { field: "fecha", label: "Fecha de consulta", renderCell: (v) => dateText(v) },
];
const equipmentColumns = [
  { field: "codigo", label: "Código" }, { field: "nombre", label: "Equipamiento" }, { field: "categoria", label: "Categoría" },
  { field: "lateral", label: "Lateral", renderCell: (v) => v || "Sin determinar" },
  { field: "tipo", label: "Tipo" }, { field: "pk_m", label: "PK eje", renderCell: (v) => pk(v) }, { field: "radio_m", label: "Radio · m", renderCell: (v) => number(v) },
];
function RecordTable({ id, title, queryId, rows, columns, onSelect, sourceRows = rows, variant = "card", compact = false }) {
  const context = React.useContext(AlternativeContext);
  const originals = new Map(rows.map((row) => [row.id, row]));
  const originalRow = (row) => originals.get(row.id) || row;
  // Search the visible values, keeping image bytes and geometry in source evidence.
  const displayRows = rows.map((row) => ({ ...Object.fromEntries(columns.map((column) => [column.field, row[column.field]])), id: row.id,
    es_referencia_municipal: row.es_referencia_municipal, fecha_futura_fuente: row.fecha_futura_fuente,
    imagen_estado: row.foto ? "Imagen disponible" : "Sin imagen", ubicacion_resumen: locationSummary(row), ubicacion_metodo: locationMethod(row) }));
  const hasPhotos = rows.some((row) => row.foto);
  const displayColumns = [columns[0], ...(hasPhotos ? [{ field: "imagen_estado", label: "Imagen", renderCell: (value, displayRow) => {
    const row = originalRow(displayRow);
    return row.foto ? <button type="button" className="k5-table-image-button" aria-label={`Ver imagen y ubicación de ${recordCode(row)}`} onClick={() => onSelect({ type: queryId, row })}><img className="k5-table-image" src={row.foto} alt={`Imagen de ${recordCode(row)}`} loading="lazy" /></button>
      : <span className="k5-table-no-image">{value}</span>;
  } }] : []), { field: "ubicacion_resumen", label: "Ubicación", renderCell: (value, displayRow) => {
    const row = originalRow(displayRow);
    return <button type="button" className="k5-table-location-button" onClick={() => onSelect({ type: queryId, row })} aria-label={`Ver ubicación de ${recordCode(row)}`}>{value}</button>;
  } }, ...columns.slice(1).map((column) => compact && column.field === "area_ddv_m2" ? { ...column, label: "DDV · m²" } : column)];
  return <DataComponent id={id} title={title} queryId={queryId} kind="table" displayRows={displayRows} {...alternativeEvidence(queryId, sourceRows, context?.alternative, context?.queries)} variant={variant} className={`k5-record-table ${compact ? "k5-record-table--compact" : ""}`}>
    <div className="k5-table-summary" data-reviewed-rows><span><b>{number(rows.length)}</b> {compact ? "parcelas" : "registros"}</span>{hasPhotos && <span><b>{number(rows.filter((row) => row.foto).length)}</b> con imagen</span>}<span><b>{number(rows.filter(hasLocation).length)}</b> con ubicación</span>{!compact && <small>Abre una fila para consultar su ficha y mapa</small>}</div>
    <DataTable rows={displayRows} columns={displayColumns} rowKey="id" label={title} onRowSelect={(row) => onSelect({ type: queryId, row: originalRow(row) })} rowActionLabel={(row) => `Ver ficha de ${recordCode(originalRow(row))}`} />
  </DataComponent>;
}
function RecordListDialog({ list, selected, onClose, onSelect }) {
  if (!list) return null;
  return <Dialog open={!selected} onClose={onClose} expanded title={`${list.title} · ${number(list.rows.length)} registros`} className="k5-record-list-dialog">
    <div className="k5-record-list-content">
      <p className="k5-scope-note">Parcelas y ofertas de la selección actual. Abre un registro para consultar sus características y ubicación.</p>
      <RecordTable id={`k5-drilldown-${list.id}`} title={list.title} queryId={list.type} rows={list.rows} columns={list.columns} onSelect={onSelect} />
    </div>
  </Dialog>;
}
function PhotoRecords({ rows, type, onSelect, colors }) {
  return <div className="k5-photo-grid" data-reviewed-rows>{rows.slice(0, 8).map((row) => <button type="button" className="k5-photo-record" key={row.id} onClick={() => onSelect({ type, row })}>
    {row.foto ? <img src={row.foto} alt={`${isAerial(row) ? "Vista aérea" : "Fotografía"} de ${row.codigo}`} loading="lazy" /> : <div className="k5-photo-absent" style={{ "--photo-color": type === "comparables" ? colors.comparables : colors[row.categoria] }}><span>{row.codigo}</span><small>Sin fotografía pública</small></div>}
    <div><strong>{row.codigo} <span>{type === "comparables" ? money(unitPrice(row, "oferta")) + "/m² de oferta" : row.categoria}</span></strong><p>{row.nombre || shortUse(row.uso_suelo) || "Sin clasificación"}</p><small>{row.tramo2500 || "Ubicación de fuente"}{row.foto ? ` · ${isAerial(row) ? "Vista aérea" : "Fotografía"}` : ""}</small></div>
  </button>)}</div>;
}

export function DashboardContent() {
  const { snapshot, queries, reviewedRows, filters, setFilter, visible } = useDataApp();
  const { activeTabId } = useDashboardTabs(tabs.filter((tab) => tab.id !== "equipamientos" || (queries.equipamientos?.rows || []).length > 0).map((tab) => ({ ...tab, filterIds: tab.id === "cobertura" ? ["alternativa", "tramo2500"] : tab.id === "mercado" ? ["alternativa", "tramo2500", "tipo_inmueble"]
    : tab.id === "equipamientos" ? ["alternativa", "tramo2500", "lateral"] : ["alternativa", "tramo2500", "lateral", "uso_suelo", ...(tab.id === "mercado" || tab.id === "registros" ? ["tipo_inmueble"] : [])] })));
  const active = activeTabId || "territorio", [selected, setSelected] = useState(null), [recordType, setRecordType] = useState("parcelas");
  const [recordList, setRecordList] = useState(null);
  const [marketMeasure, setMarketMeasure] = useState("oferta"), [marketAxis, setMarketAxis] = useState("area_terreno_m2");
  const alternatives = queries.alternativas?.rows || [];
  const initialAlternative = String(filters.alternativa || alternatives[0]?.id || "1");
  const [alternativeId, setAlternativeId] = useState(initialAlternative);
  const alternative = alternatives.find((entry) => String(entry.id) === alternativeId);
  const alternativeSync = useRef({ tab: active, filter: String(filters.alternativa || alternatives[0]?.id || "1") });
  useEffect(() => {
    if (!alternatives.length) return;
    const filterId = String(filters.alternativa || alternatives[0]?.id || "1");
    const previous = alternativeSync.current;
    if (previous.tab !== active) {
      alternativeSync.current = { tab: active, filter: alternativeId };
      if (filterId !== alternativeId) setFilter("alternativa", alternativeId);
    } else if (previous.filter !== filterId && alternatives.some((entry) => String(entry.id) === filterId)) {
      alternativeSync.current = { tab: active, filter: filterId };
      setSelected(null); setRecordList(null); setAlternativeId(filterId);
    } else if (filterId !== alternativeId) {
      alternativeSync.current = { tab: active, filter: alternativeId };
      setFilter("alternativa", alternativeId);
    }
  }, [active, filters.alternativa, alternativeId, alternatives.length]);
  const parcelOverrides = useMemo(() => new Map((alternative?.parcelas_overrides || []).map((entry) => [entry.parcela_codigo, entry])), [alternative]);
  const baseMeta = queries.metadatos?.rows?.[0] || {};
  const mergedMeta = useMemo(() => ({ ...baseMeta, ...alternative?.meta }), [baseMeta, alternative]);
  const alternativeCartography = useMemo(() => {
    const base = queries.cartografia?.rows || [];
    if (!alternative?.cartografia) return base;
    const replaced = alternative.cartografia_reemplazar_capas;
    return replaced ? [...base.filter((entry) => !replaced.includes(entry.capa)), ...alternative.cartografia] : alternative.cartografia;
  }, [queries.cartografia, alternative]);
  const alternativeRows = (entries) => entries.filter((entry) => !entry.alternativa || [alternativeId, alternative?.label].filter(Boolean).includes(String(entry.alternativa)));
  const allRows = (q) => q === "metadatos" ? [mergedMeta] : alternativeRows(q === "cartografia" ? alternativeCartography : alternative?.[q] || queries[q]?.rows || []);
  const rows = (q) => {
    let scoped = queries[q] ? reviewedRows(q, ["id"]) : [];
    if (q === "parcelas" && filters.tramo2500 && filters.tramo2500 !== "all") scoped = scoped.filter((entry) => (entry.tramos_fuente || [entry.tramo2500]).map(String).includes(String(filters.tramo2500)));
    if (q === "parcelas" && filters.tramo2500 && filters.tramo2500 !== "all") scoped = scoped.map((entry) => ({ ...entry, area_ddv_m2: entry.area_ddv_por_tramo?.[filters.tramo2500] ?? null }));
    return q === "parcelas" ? scoped.map((entry) => parcelOverrides.has(entry.parcela_codigo) ? { ...entry, ...parcelOverrides.get(entry.parcela_codigo) } : entry) : scoped;
  };
  const selectedPropertyType = filters.tipo_inmueble && filters.tipo_inmueble !== "all" ? filters.tipo_inmueble : "Terreno";
  const parcelas = rows("parcelas"), comparables = rows("comparables").filter((entry) => active === "mercado" || (active === "registros" && recordType === "comparables") ? entry.tipo_inmueble === selectedPropertyType : true), equipamientos = rows("equipamientos");
  const metaRow = allRows("metadatos")[0] || {}, meta = metaRow.meta || metaRow;
  const equipmentAvailable = meta.equipamientos_disponibles === true || (queries.equipamientos?.rows || []).length > 0;
  const propertyTypes = [...new Set((queries.comparables?.rows || []).map((entry) => entry.tipo_inmueble).filter(Boolean))];
  const uses = { ...fallbackUses, ...meta.paleta?.usos }, pointColors = { ...defaultPoints, ...meta.paleta?.puntos };
  const tramoValue = filters.tramo2500;
  const selectedTramos = allRows("indicadores_tramo").filter((r) => !tramoValue || tramoValue === "all" || String(r.tramo2500 ?? r.id) === String(tramoValue));
  const rangeFiltered = selectedTramos.length < allRows("indicadores_tramo").length;
  const rangeMin = Math.min(...selectedTramos.map((r) => r.pk_desde_m)), rangeMax = Math.max(...selectedTramos.map((r) => r.pk_hasta_m));
  const cartografia = allRows("cartografia").filter((r) => !rangeFiltered || (r.tramo2500 != null ? String(r.tramo2500) === String(tramoValue) : r.pk_desde_m == null || r.pk_hasta_m == null || (r.pk_desde_m === r.pk_hasta_m ? r.pk_desde_m >= rangeMin && r.pk_desde_m <= rangeMax : r.pk_hasta_m > rangeMin && r.pk_desde_m < rangeMax)));
  const sourceRowsByQuery = { parcelas: canonicalRows("parcelas", parcelas, queries), comparables: canonicalRows("comparables", comparables, queries), equipamientos: canonicalRows("equipamientos", equipamientos, queries), cartografia: canonicalRows("cartografia", cartografia, queries), metadatos: queries.metadatos?.rows || [], ...(alternative ? { alternativas: [alternative] } : {}) };
  const areaKnown = sumKnown(selectedTramos, "area_ddv_conocida_m2"), areaInventory = sumKnown(selectedTramos, "area_ddv_inventario_m2");
  const inventoryScope = (alternative?.areas_inventario_union || []).find((entry) => entry.tramo2500 === (filters.tramo2500 || "all") && entry.uso_suelo === (filters.uso_suelo || "all"));
  const filteredInventoryArea = inventoryScope?.area_ddv_m2 ?? (parcelas.length === 0 ? 0 : null);
  const territorialUses = aggregateNested(selectedTramos, "usos"), magAreas = aggregateNested(selectedTramos, "clases_mag");
  const marketRows = comparables.map((r) => ({ ...r, precio_unitario: unitPrice(r, marketMeasure) }));
  const prices = marketRows.filter((r) => r.precio_unitario != null && Number.isFinite(Number(r.precio_unitario)));
  const medianPrice = median(prices.map((r) => r.precio_unitario));
  const scatter = prices.filter((r) => (marketAxis === "pk_m" ? r.pk_m : r.base_area_m2) != null).map((r) => ({ ...r, uso: shortUse(r.uso_suelo) || "Sin clasificación", pk_km: r.pk_m == null ? null : r.pk_m / 1000 }));
  const selectedMarketColumns = marketColumns.map((column) => column.field === "precio_m2" ? { ...column, field: "precio_unitario", label: `${marketMeasures[marketMeasure]} · US$/m² ${selectedPropertyType === "Terreno" ? "terreno" : "construido"}` } : column);
  const openRecords = (id, title, type, selectedRows) => setRecordList({ id, title, type, rows: selectedRows,
    columns: type === "parcelas" ? parcelColumns : type === "comparables" ? selectedMarketColumns : equipmentColumns });
  const countDetails = {
    "k5-parcelas": ["parcelas", parcelas], "k5-comparables": ["comparables", marketRows], "k5-equipamientos": ["equipamientos", equipamientos],
    "k5-market-count": ["comparables", prices], "k5-market-located": ["comparables", marketRows.filter((r) => r.geometry)],
    "k5-equipment-total": ["equipamientos", equipamientos],
    "k5-equipment-schools": ["equipamientos", equipamientos.filter((r) => r.categoria === "Centros escolares")],
    "k5-equipment-churches": ["equipamientos", equipamientos.filter((r) => r.categoria === "Iglesias")],
    "k5-equipment-located": ["equipamientos", equipamientos.filter((r) => r.geometry)],
    "k5-linked-records": ["parcelas", parcelas.filter((r) => r.geometry)],
  };
  const parcelsByTramo = selectedTramos.map((tramo) => ({ tramo: tramo.etiqueta, parcelas: parcelas.filter((entry) => (entry.tramos_fuente || [entry.tramo2500]).includes(tramo.tramo2500)).length }));
  const equipmentCount = groupRows(equipamientos, "categoria"), equipmentByTramo = selectedTramos.map((r) => ({ tramo: r.etiqueta, registros: equipamientos.filter((e) => String(e.tramo2500) === String(r.tramo2500 ?? r.id)).length }));
  const recordRows = { parcelas, comparables: marketRows, equipamientos }[recordType];
  const scopeNote = active !== "cobertura" && ((filters.lateral && filters.lateral !== "all") || (active === "territorio" && filters.uso_suelo && filters.uso_suelo !== "all"));
  const mapProps = { parcelas, comparables, equipamientos, cartografia, meta, sourceRowsByQuery, selected, onSelect: setSelected };
  const activeFilterIds = active === "cobertura" || active === "mercado" ? ["tramo2500"]
    : active === "equipamientos" || (active === "registros" && recordType === "equipamientos") ? ["tramo2500", "lateral"] : ["tramo2500", "lateral", "uso_suelo"];
  const filterDefinitions = (snapshot.filters || []).filter((definition) => activeFilterIds.includes(definition.id)).map((definition) => ({ ...definition, allLabel: "Todos",
    choiceLabels: definition.id === "tramo2500" ? Object.fromEntries(allRows("indicadores_tramo").map((r) => [String(r.tramo2500 ?? r.id), r.pk_desde_m != null && r.pk_hasta_m != null ? `${pk(r.pk_desde_m)} – ${pk(r.pk_hasta_m)}` : r.etiqueta]))
      : definition.id === "uso_suelo" ? Object.fromEntries(Object.keys(uses).map((key) => [key, shortUse(key)])) : definition.choiceLabels }));
  const filterChoiceQueries = Object.fromEntries(Object.entries(queries).map(([key, query]) => [key, { ...query, rows: [...query.rows].sort((left, right) => String(left.tramo2500 || "").localeCompare(String(right.tramo2500 || ""), "es", { numeric: true })) }]));
  const item = (id, title, span, child, kind = "chart") => visible(id) && <SortableItem id={id} label={title} key={id} span={span} kind={kind}>{child}</SortableItem>;
  const selectedScope = [
    tramoValue && tramoValue !== "all" && selectedTramos[0] ? selectedTramos[0].pk_desde_m != null ? `PK ${pk(selectedTramos[0].pk_desde_m)} – ${pk(selectedTramos[selectedTramos.length - 1].pk_hasta_m)}` : selectedTramos[0].etiqueta : "Corredor completo",
    active !== "cobertura" && filters.lateral && filters.lateral !== "all" ? `Lateral ${String(filters.lateral).toLowerCase()}` : active !== "cobertura" && (snapshot.filters || []).some((entry) => entry.id === "lateral") ? "Ambos laterales" : null,
    activeFilterIds.includes("uso_suelo") && filters.uso_suelo && filters.uso_suelo !== "all" ? shortUse(filters.uso_suelo) : null,
    active === "mercado" || active === "registros" && recordType === "comparables" ? selectedPropertyType : null,
  ].filter(Boolean);
  const metric = (id, title, value, q, evidence, description, note) => {
    const equipmentMetric = ["k5-equipamientos", "k5-equipment-total", "k5-equipment-schools", "k5-equipment-churches", "k5-equipment-located"].includes(id);
    const detail = equipmentMetric && !equipmentAvailable ? null : countDetails[id];
    if (equipmentMetric && !equipmentAvailable) { value = "—"; note = "Inventario no disponible"; description = "Las fuentes revisadas no contienen un inventario de equipamientos. La ausencia de datos no acredita ausencia de servicios."; }
    const reading = detail ? <button type="button" className="k5-count-link" aria-label={`Ver ${title.toLowerCase()}: ${value} registros`} onClick={() => openRecords(id, title, detail[0], detail[1])}>{value}</button> : value;
    return item(id, title, 3, <MetricCard id={id} title={title} value={reading} queryId={q} {...alternativeEvidence(q, detail ? detail[1] : evidence, alternative, queries)} displayRows={detail ? detail[1] : evidence} description={description} className="k5-metric">
      {note && <span className="k5-metric-note" data-reviewed-rows>{note}</span>}{detail && <span className="k5-metric-action-hint">Consultar registros <span aria-hidden="true">↗</span></span>}
    </MetricCard>, "metric");
  };
  const row = (id, items, label, kind) => ({ id: `k5:${id}`, items, label, kind });
  const region = (id, blockRows, children) => <SortableRegion id={`k5:${id}`} label={`Paneles de ${id}`} variant="canvas" columns={12} spacing="standard" authoredRevision={1} rows={blockRows}>{flatChildren(children)}</SortableRegion>;
  return <AlternativeContext.Provider value={{ alternative, queries }}><article className="k5-dashboard">
    <header className="k5-institutional-header k5-institutional-header--corredor">
      <div className="cn-institutional-brand cn-institutional-brand--mopt"><img src={moptLogo} width="732" height="258" alt="Ministerio de Obras Públicas y de Transporte · Gobierno de El Salvador" /></div>
      <div className="k5-institutional-project"><span className="k5-project-eyebrow">Estudio territorial y de mercado</span><strong>{meta.titulo || "Corredor Norte · Nor-Poniente AMSS"}</strong><span>Inventario predial · alternativas · referencias de oferta</span><div className="k5-document-status" data-reviewed-rows><strong>{meta.revision || "GIS"}</strong><span>Base revisada · {dateText(meta.fecha)}</span></div></div>
      <div className="cn-institutional-brand cn-institutional-brand--contracta"><img src={contractaLogo} width="305" height="102" alt="Contracta Construction UK" /></div>
    </header>
    <AlternativeSelector alternatives={alternatives} value={alternativeId} queries={queries} parcelas={canonicalRows("parcelas", parcelas, queries)} tramoValue={tramoValue} filterValues={filters} onChange={(value) => { setSelected(null); setRecordList(null); setAlternativeId(String(value)); }} />
    <Filters sticky filters={filterDefinitions} queries={filterChoiceQueries} values={filters} onChange={setFilter} clearLabel="Limpiar filtros" trailingControls={<span className="k5-revision">{alternative?.label || "Selección del corredor"}</span>} />
    <div className="k5-page-intro"><div><h2>{tabs.find((tab) => tab.id === active)?.label || "Síntesis territorial"}</h2></div><div className="k5-scope-tags" aria-label="Alcance de la selección" data-reviewed-rows>{selectedScope.map((label) => <span key={label}>{label}</span>)}</div></div>
    {scopeNote && <p className="k5-scope-note" data-reviewed-rows>El uso normativo filtra las parcelas. El mercado responde a la alternativa y al tramo. DDV total corresponde al corredor o tramo; DDV en parcelas corresponde a la unión de la selección por uso y tramo.</p>}
    {active === "territorio" && <>
      <SortableRegion id="cn:territorio:summary" variant="freeform" className="cn-metric-strip" authoredRevision={2} label="Selección territorial">
        {metric("k5-parcelas", "Parcelas en selección", number(parcelas.length), "parcelas", parcelas, "Parcelas únicas de la alternativa seleccionada, con cualquier intersección en el tramo y uso principal elegido.", "Abrir inventario filtrado")}
        {metric("cn-inventory-area", "Afectación en parcelas", hectares(filteredInventoryArea), "parcelas", parcelas, "Unión de las afectaciones de las parcelas seleccionadas. Cuenta los solapes una sola vez y recorta por el tramo activo.", "Unión sin duplicar solapes")}
      </SortableRegion>
      {region("territorio", [row("territorio:map", ["k5-map", "k5-use-composition"], "Territorio y usos"), row("territorio:analysis", ["k5-ddv-tramos", "cn-parcels-tramos"], "Comparación por tramo")], <>
        {item("k5-map", "Corredor territorial", 8, <TerritorialMap id="k5-map" title="Corredor territorial" {...mapProps} />)}
        {item("k5-use-composition", "Uso normativo principal", 4, <ParcelUseInventory parcelas={parcelas} colors={uses} alternative={alternative} queries={queries} selectedUse={filters.uso_suelo} onFilter={(value) => setFilter("uso_suelo", value)} onSelect={setSelected} scopeKey={`${alternativeId}:${filters.tramo2500 || "all"}:${filters.uso_suelo || "all"}`} />)}
        {item("k5-ddv-tramos", "DDV por tramo", 6, <EvidenceChart id="k5-ddv-tramos" title="Superficie DDV por tramo" queryId="indicadores_tramo" rows={selectedTramos.map((r) => ({ tramo: r.etiqueta, hectareas: r.area_ddv_conocida_m2 == null ? null : r.area_ddv_conocida_m2 / 10000 }))} {...alternativeEvidence("indicadores_tramo", selectedTramos, alternative, queries)} variant="card" spec={{ type: "horizontalBar", x: "tramo", y: "hectareas", yLabel: "ha", showXAxisLabel: false, valueDecimals: 2, colors: { hectareas: "#bd7853" } }} height={240} description="Derecho de vía completo por tramo de la alternativa activa. Su superficie conserva el universo territorial, independientemente del uso normativo filtrado." />)}
        {item("cn-parcels-tramos", "Parcelas por tramo", 6, <EvidenceChart id="cn-parcels-tramos" title="Parcelas por tramo" queryId="parcelas" rows={parcelsByTramo} {...alternativeEvidence("parcelas", parcelas, alternative, queries)} variant="card" spec={{ type: "horizontalBar", x: "tramo", y: "parcelas", showXAxisLabel: false, valueDecimals: 0, colors: { parcelas: "#163f4d" } }} height={240} description="Parcelas de la selección que intersectan cada tramo. Una parcela puede cruzar más de un tramo; estos conteos no se suman como parcelas distintas." />)}
      </>)}
    </>}
    {active === "mercado" && <><div className="k5-market-controls"><Dropdown label="Tipo de inmueble" showLabel value={selectedPropertyType} choices={propertyTypes} onChange={(value) => { setSelected(null); setRecordList(null); setFilter("tipo_inmueble", value); }} /><Dropdown label="Precio unitario" showLabel value={marketMeasure} choices={Object.keys(marketMeasures).filter((key) => key === "oferta" || comparables.some((entry) => unitPrice(entry, key) != null))} choiceLabels={marketMeasures} onChange={setMarketMeasure} /><span className="k5-measure-definition">{marketMeasure === "oferta" ? "Precio de oferta ÷ área de referencia del mismo tipo de inmueble" : marketMeasure === "ajustado" ? "Precio unitario ajustado del estudio" : "Valor unitario de comercialización del estudio"}</span></div>
      {comparables.some((row) => row.es_referencia_municipal || row.fecha_futura_fuente) && <p className="k5-market-reference-note" data-reviewed-rows>{number(comparables.filter((row) => row.es_referencia_municipal).length)} referencias municipales se consultan por separado en la tabla y las fichas; no integran la mediana ajustada. {comparables.some((row) => row.fecha_futura_fuente) ? `${number(comparables.filter((row) => row.fecha_futura_fuente).length)} registros conservan una fecha futura de fuente pendiente de revisión.` : ""}</p>}
      {region("mercado", [row("mercado:metrics", ["k5-market-median", "k5-market-count", "k5-market-area", "k5-market-located"], "Mercado seleccionado", "metrics"), row("mercado:charts", ["k5-market-scatter"], "Precio y superficie"), row("mercado:map", ["k5-market-map"], "Ubicación de comparables"), row("mercado:records", ["k5-market-records"], "Detalle de mercado")], <>
      {metric("k5-market-median", `Mediana · ${marketMeasures[marketMeasure].toLowerCase()}`, medianPrice == null ? "—" : `${money(medianPrice)}/m²`, "comparables", comparables, `Mediana del precio unitario ${marketMeasures[marketMeasure].toLowerCase()} del tipo de inmueble seleccionado, recalculada con registros individuales disponibles; no mezcla terreno y construcción.`, "US$/m² · selección actual")}
      {metric("k5-market-count", "Comparables con precio", number(prices.length), "comparables", comparables, "Registros con el precio unitario seleccionado disponible; los valores ausentes se excluyen.", "Base de la mediana")}
      {metric("k5-market-area", "Área mediana de referencia", `${number(median(comparables.map((r) => r.base_area_m2)))} m²`, "comparables", comparables, "Mediana del área de referencia del tipo de inmueble seleccionado. Terrenos usan área de terreno; casas y apartamentos, área construida.", selectedPropertyType === "Terreno" ? "Área del terreno" : "Área construida")}
      {metric("k5-market-located", "Comparables ubicados", number(comparables.filter((r) => r.geometry).length), "comparables", comparables, "Registros con coordenadas utilizables.", `de ${number(comparables.length)} registros`)}
      {item("k5-market-scatter", "Precio unitario y localización", 12, scatter.length ? <EvidenceChart id="k5-market-scatter" title={marketAxis === "pk_m" ? "Precio unitario a lo largo del corredor" : "Precio de oferta y área de referencia"} queryId="comparables" rows={scatter} sourceRows={comparables} spec={{ type: "scatter", x: marketAxis === "pk_m" ? "pk_km" : "base_area_m2", y: "precio_unitario", series: "uso", xLabel: marketAxis === "pk_m" ? "Progresiva proyectada al eje · km" : selectedPropertyType === "Terreno" ? "Terreno · m²" : "Construcción · m²", yLabel: `US$/m² · ${marketMeasures[marketMeasure].toLowerCase()}`, valueDecimals: 2, stackable: false, colors: Object.fromEntries(Object.entries(uses).map(([key, color]) => [shortUse(key), color])) }} variant="card" height={300}
        headerControls={<Dropdown label="Eje" showLabel value={marketAxis} choices={comparables.some((entry) => entry.pk_m != null) ? ["pk_m", "area_terreno_m2"] : ["area_terreno_m2"]} choiceLabels={{ pk_m: "Progresiva", area_terreno_m2: "Área de referencia" }} onChange={setMarketAxis} />}
        description="El gráfico usa el área de referencia del tipo de inmueble seleccionado. Los terrenos se expresan por m² de suelo y las viviendas por m² construido cuando la fuente lo permite. No se calcula una progresiva oficial a partir de ubicaciones aproximadas." chartOptions={{ getMarkActions: ({ row: r }) => [{ label: `Ver ficha ${r.codigo}`, onSelect: () => setSelected({ type: "comparables", row: r }) }] }} /> : <DataComponent id="k5-market-scatter" title="Precio de oferta y área de referencia" queryId="comparables" kind="custom" variant="card" {...alternativeEvidence("comparables", comparables, alternative, queries)} displayRows={comparables}><p className="cn-market-empty" data-reviewed-rows>{comparables.length ? "La selección conserva sus ofertas y ubicación. Faltan pares válidos de precio unitario y superficie para construir el gráfico; consulta los valores disponibles en la tabla." : "No hay comparables de este tipo de inmueble en el tramo seleccionado. Cambia el tramo o el tipo de inmueble para consultar otras ofertas."}</p></DataComponent>)}
      {item("k5-market-map", "Localización del mercado", 12, <TerritorialMap id="k5-market-map" title="Localización del mercado" {...mapProps} compact initialLayers={{ mag: true, parcelas: false, equipamientos: false }} />)}
      {item("k5-market-records", "Comparables del estudio", 12, <RecordTable id="k5-market-records" title="Comparables del estudio" queryId="comparables" rows={marketRows} sourceRows={comparables} columns={selectedMarketColumns} onSelect={setSelected} />, "table")}
    </>)}</>}
    {active === "equipamientos" && !equipmentAvailable && <DataComponent id="k5-equipment-unavailable" title="Inventario de equipamientos no disponible" queryId="equipamientos" queryIds={["equipamientos", "metadatos"]} sourceRowsByQuery={{ equipamientos: queries.equipamientos?.rows || [], metadatos: queries.metadatos?.rows || [] }} displayRows={[]} kind="custom" variant="card"><p className="k5-empty">Las fuentes revisadas no incluyen un inventario de equipamientos. No se asignan cantidades, coordenadas, fotografías ni radios de referencia.</p></DataComponent>}
    {active === "equipamientos" && equipmentAvailable && region("equipamientos", [row("equipamientos:metrics", ["k5-equipment-total", "k5-equipment-schools", "k5-equipment-churches", "k5-equipment-located"], "Equipamientos seleccionados", "metrics"), row("equipamientos:map", ["k5-equipment-map", "k5-equipment-category"], "Localización y función"), row("equipamientos:distribution", ["k5-equipment-tramos"], "Distribución longitudinal"), row("equipamientos:records", ["k5-equipment-records"], "Inventario")], <>
      {metric("k5-equipment-total", "Equipamientos", number(equipamientos.length), "equipamientos", equipamientos, "Registros del inventario según los filtros de tramo y lateral.", "Inventario del corredor")}
      {metric("k5-equipment-schools", "Centros escolares", number(equipamientos.filter((r) => r.categoria === "Centros escolares").length), "equipamientos", equipamientos, "Equipamientos clasificados como centros escolares.", "Categoría del inventario")}
      {metric("k5-equipment-churches", "Iglesias", number(equipamientos.filter((r) => r.categoria === "Iglesias").length), "equipamientos", equipamientos, "Equipamientos clasificados como iglesias.", "Categoría del inventario")}
      {metric("k5-equipment-located", "Con ubicación", number(equipamientos.filter((r) => r.geometry).length), "equipamientos", equipamientos, "Registros con coordenadas utilizables.", `${number(equipamientos.filter((r) => generatesRadius(r) && r.geometry).length)} radios de fuente`)}
      {item("k5-equipment-map", "Equipamientos del corredor", 8, <TerritorialMap id="k5-equipment-map" title="Equipamientos del corredor" {...mapProps} initialLayers={{ parcelas: false, mag: true, comparables: false, radios: true }} />)}
      {item("k5-equipment-category", "Equipamientos por función", 4, <DataComponent id="k5-equipment-category" title="Equipamientos por función" queryId="equipamientos" kind="custom" variant="card" sourceRows={equipamientos} displayRows={equipmentCount}><Composition rows={equipmentCount} colors={pointColors} unit="equipamientos" onSelect={(category) => openRecords("categoria-equipamientos", category, "equipamientos", equipamientos.filter((r) => r.categoria === category))} /><p className="k5-card-note">Los radios se dibujan únicamente cuando la fuente consigna una distancia. Son referencias geométricas y no expresan tiempos de viaje ni cobertura efectiva.</p></DataComponent>)}
      {item("k5-equipment-tramos", "Equipamientos por tramo", 12, <EvidenceChart id="k5-equipment-tramos" title="Equipamientos por tramo" queryId="equipamientos" rows={equipmentByTramo} sourceRows={equipamientos} variant="card" spec={{ type: "bar", x: "tramo", y: "registros", showXAxisLabel: false, colors: { registros: "#61879a" }, valueDecimals: 0 }} height={220} />)}
      {item("k5-equipment-records", "Inventario de equipamientos", 12, <RecordTable id="k5-equipment-records" title="Inventario de equipamientos" queryId="equipamientos" rows={equipamientos} columns={equipmentColumns} onSelect={setSelected} />, "table")}
    </>)}
    {active === "registros" && <><div className="k5-record-controls"><SegmentedControl ariaLabel="Tipo de registro" value={recordType} onChange={setRecordType} options={[{ value: "parcelas", label: "Parcelas" }, { value: "comparables", label: "Comparables" }, { value: "equipamientos", label: "Equipamientos" }]} />{recordType === "comparables" && <Dropdown label="Tipo de inmueble" showLabel value={selectedPropertyType} choices={propertyTypes} onChange={(value) => setFilter("tipo_inmueble", value)} />}</div>
      {recordType === "equipamientos" && !equipmentAvailable && <p className="k5-scope-note">Inventario de equipamientos no disponible en las fuentes revisadas.</p>}
      {region(`registros:${recordType}`, [row(`registros:${recordType}:table`, [`k5-register-${recordType}`], "Registros seleccionados"), ...(recordRows.some((entry) => entry.foto) ? [row(`registros:${recordType}:photos`, [`k5-photos-${recordType}`], "Fichas visuales")] : [])], <>
        {item(`k5-register-${recordType}`, "Registros seleccionados", 12, <RecordTable id={`k5-register-${recordType}`} title={`${recordType === "parcelas" ? "Parcelas" : recordType === "comparables" ? "Comparables" : "Equipamientos"} · ${number(recordRows.length)} registros`} queryId={recordType} rows={recordRows} columns={recordType === "parcelas" ? parcelColumns : recordType === "comparables" ? selectedMarketColumns : equipmentColumns} onSelect={setSelected} />, "table")}
        {recordRows.some((entry) => entry.foto) && item(`k5-photos-${recordType}`, "Fichas visuales", 12, <DataComponent id={`k5-photos-${recordType}`} title="Fichas visuales" queryId={recordType} kind="custom" variant="card" sourceRows={recordRows.slice(0, 8)} displayRows={recordRows.slice(0, 8)} description="Primeros ocho registros seleccionados; todas las fichas están disponibles en la tabla."><PhotoRecords rows={recordRows} type={recordType} onSelect={setSelected} colors={pointColors} /></DataComponent>)}
      </>)}
    </>}
    {active === "cobertura" && region("cobertura", [row("cobertura:metrics", ["k5-known-area", "k5-inventory-area", "k5-linked-records", "k5-partial-segments"], "Alcance de la información", "metrics"), row("cobertura:chart", ["k5-coverage-chart", "k5-territorial-use"], "Cobertura territorial"), row("cobertura:method", ["k5-method"], "Fuentes y límites")], <>
      {metric("k5-known-area", "DDV conocido", hectares(areaKnown), "indicadores_tramo", selectedTramos, "Área territorial conocida del DDV en el tramo seleccionado.", "Maestro GIS · cierre geométrico")}
      {metric("k5-inventory-area", "DDV con inventario", hectares(areaInventory), "indicadores_tramo", selectedTramos, "Superficie territorial DDV vinculada al inventario a partir del cierre exclusivo por tramo.", `${areaKnown ? number(areaInventory / areaKnown * 100, 1) : "—"}% del DDV conocido`)}
      {metric("k5-linked-records", "Parcelas vinculadas", number(parcelas.filter((r) => r.geometry).length), "parcelas", parcelas, "Filas con geometría vinculada; el conteo puede diferir del de contornos únicos.", `de ${number(parcelas.length)} filas del inventario`)}
      {metric("k5-partial-segments", "Tramos revisados", number(selectedTramos.length), "indicadores_tramo", selectedTramos, "Tramos de fuente incluidos en la selección actual.", selectedTramos.some((r) => /parcial/.test(r.estado_cobertura)) ? "Incluye cobertura parcial" : "Con cierre geométrico")}
      {item("k5-coverage-chart", "Cobertura del inventario en el DDV", 7, <EvidenceChart id="k5-coverage-chart" title="Cobertura del inventario en el DDV" queryId="indicadores_tramo" rows={selectedTramos.map((r) => ({ tramo: r.etiqueta, inventario_ha: r.area_ddv_inventario_m2 == null ? null : r.area_ddv_inventario_m2 / 10000, cad_sin_vinculo_ha: r.area_ddv_cad_sin_excel_m2 == null ? null : r.area_ddv_cad_sin_excel_m2 / 10000, residual_ha: r.area_ddv_residual_m2 == null ? null : r.area_ddv_residual_m2 / 10000, sin_cobertura_ha: r.area_sin_cobertura_m2 == null ? null : r.area_sin_cobertura_m2 / 10000 }))} {...alternativeEvidence("indicadores_tramo", selectedTramos, alternative, queries)} variant="card" height={280} spec={{ type: "stackedBar", x: "tramo", y: "inventario_ha", fields: ["inventario_ha", "cad_sin_vinculo_ha", "residual_ha"], yLabel: "ha", showXAxisLabel: false, valueDecimals: 2, colors: { inventario_ha: "#afbd8d", cad_sin_vinculo_ha: "#a5bcc9", residual_ha: "#d5c18e", sin_cobertura_ha: "#d7d3c7" }, legend: { labels: { inventario_ha: "Parcelas", cad_sin_vinculo_ha: "Vías y áreas especiales", residual_ha: "Resto del DDV" } } }} description="Tres categorías exclusivas concilian el DDV por tramo: unión en parcelas, vías y áreas especiales, y resto del DDV. Los solapes se cuentan una sola vez." />)}
      {item("k5-territorial-use", "Usos en DDV con cobertura CAD", 5, <DataComponent id="k5-territorial-use" title="Usos normativos y afectación DDV" queryId="indicadores_tramo" kind="custom" variant="card" {...alternativeEvidence("indicadores_tramo", selectedTramos, alternative, queries)} displayRows={territorialUses} description="Superficie por categoría normativa principal de las parcelas en el DDV. Las áreas por categoría pueden compartir pequeños solapes catastrales; se muestran sin porcentajes y no deben sumarse como partición exclusiva."><Composition rows={territorialUses} colors={uses} unit="ha" additive={false} /></DataComponent>)}
      {item("k5-method", "Fuentes y alcance", 12, <DataComponent id="k5-method" title="Fuentes y alcance" queryId="metadatos" kind="custom" variant="card" {...alternativeEvidence("metadatos", [metaRow], alternative, queries)} displayRows={[metaRow]}><div className="k5-method-grid" data-reviewed-rows>
        <div><h3>Base técnica</h3><p>{meta.inventario_fuente || "Inventario y geometrías revisadas del Corredor Norte"} · {meta.revision || "Revisión de fuente"}. La consulta conserva los registros de parcela y compara el derecho de vía de cada alternativa.</p><p>{meta.mercado_fuente || "Referencias de oferta del estudio de mercado"}. Los precios de oferta se consultan por tipo de inmueble; no equivalen a una tasación ni a un valor adoptado.</p><p className="k5-method-projection">{meta.crs?.nombre || "Lambert CNR"} · metros</p></div>
        <div><h3>Disponibilidad de las fuentes</h3><p>No hay fotografías prediales ni inventario puntual de equipamientos en las fuentes revisadas. Tampoco hay progresivas, lateral oficial o clasificación MAG verificados. Los registros conservan su geometría y sus valores originales.</p><h3>Precisión y cobertura</h3><ul>{(meta.limitaciones || []).filter((text) => !/fotograf|códigos públicos/i.test(text)).map((text, index) => <li key={index}>{publicMethodText(text)}</li>)}</ul></div>
      </div></DataComponent>)}
    </>)}
    <RecordListDialog list={recordList} selected={selected} onClose={() => setRecordList(null)} onSelect={setSelected} />
    <RecordDetail selected={selected} onClose={() => setSelected(null)} colors={{ usos: uses, puntos: pointColors }} mapProps={mapProps} measure={marketMeasure} />
  </article></AlternativeContext.Provider>;
}
