"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Rectangle,
  Marker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Plus Code character set
const CODE_CHARS = "23456789CFGHJMPQRVWX";

const LIGHT_TILES =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const DARK_TILES =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 48;

interface CodeBounds {
  code: string;
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Decode a 2-character Plus Code into a lat/lng bounding box. */
function decodePlusCode(code: string): CodeBounds {
  const latIdx = CODE_CHARS.indexOf(code[0]);
  const lngIdx = CODE_CHARS.indexOf(code[1]);
  if (latIdx === -1 || lngIdx === -1) {
    throw new Error(`Invalid 2-digit Plus Code: ${code}`);
  }
  const south = latIdx * 20 - 90;
  const west = lngIdx * 20 - 180;
  return { code, south, west, north: south + 20, east: west + 20 };
}

function CodeLabel({
  bounds,
  isDark,
}: {
  bounds: CodeBounds;
  isDark: boolean;
}) {
  const map = useMap();
  const [fontSize, setFontSize] = useState(12);

  const center = useMemo<L.LatLngExpression>(
    () => [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2],
    [bounds]
  );

  const updateFontSize = useCallback(() => {
    const sw = map.latLngToContainerPoint([bounds.south, bounds.west]);
    const ne = map.latLngToContainerPoint([bounds.north, bounds.east]);
    const pxWidth = Math.abs(ne.x - sw.x);
    const pxHeight = Math.abs(ne.y - sw.y);
    const minDim = Math.min(pxWidth, pxHeight);
    setFontSize(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, minDim * 0.3)));
  }, [map, bounds]);

  useMapEvents({ zoomend: updateFontSize, moveend: updateFontSize });
  useEffect(() => { updateFontSize(); }, [updateFontSize]);

  const icon = useMemo(() => {
    const color = isDark ? "#fff" : "#000";
    const shadow = isDark
      ? "0 0 4px rgba(0,0,0,0.9)"
      : "0 0 4px rgba(255,255,255,0.9)";
    return L.divIcon({
      className: "plus-code-label",
      html: `<div style="position:absolute;transform:translate(-50%,-50%);font-size:${fontSize}px;color:${color};font-weight:600;text-shadow:${shadow};white-space:nowrap;pointer-events:none;font-family:var(--font-geist-mono),ui-monospace,monospace">${bounds.code}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }, [fontSize, isDark, bounds.code]);

  return <Marker position={center} icon={icon} interactive={false} />;
}

/** Swaps the TileLayer when the theme changes (TileLayer is immutable). */
function ThemeTileLayer({ isDark }: { isDark: boolean }) {
  return (
    <TileLayer
      key={isDark ? "dark" : "light"}
      url={isDark ? DARK_TILES : LIGHT_TILES}
      attribution={TILE_ATTRIBUTION}
    />
  );
}

interface PlusCodeMapInnerProps {
  codes: string[];
  theme: string;
}

export default function PlusCodeMapInner({
  codes,
  theme,
}: PlusCodeMapInnerProps) {
  const isDark = theme === "dark";
  const decoded = useMemo(() => codes.map(decodePlusCode), [codes]);

  const mapBounds = useMemo(() => {
    if (decoded.length === 0)
      return L.latLngBounds([-90, -180], [90, 180]);
    let south = 90,
      west = 180,
      north = -90,
      east = -180;
    for (const c of decoded) {
      if (c.south < south) south = c.south;
      if (c.west < west) west = c.west;
      if (c.north > north) north = c.north;
      if (c.east > east) east = c.east;
    }
    return L.latLngBounds([south, west], [north, east]);
  }, [decoded]);

  const rectStyle: L.PathOptions = useMemo(
    () => ({
      color: isDark ? "rgba(100,180,255,0.8)" : "rgba(30,100,220,0.8)",
      fillColor: isDark ? "rgba(100,180,255,0.25)" : "rgba(30,100,220,0.2)",
      fillOpacity: 1,
      weight: 2,
    }),
    [isDark]
  );

  return (
    <div
      style={{ width: "100%", height: "400px" }}
      className="my-4 border rounded-md overflow-hidden"
    >
      <MapContainer
        bounds={mapBounds}
        boundsOptions={{ padding: [10, 10] }}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
        zoomSnap={0.5}
        zoomDelta={0.5}
      >
        <ThemeTileLayer isDark={isDark} />
        {decoded.map((c) => (
          <Rectangle
            key={c.code}
            bounds={[
              [c.south, c.west],
              [c.north, c.east],
            ]}
            pathOptions={rectStyle}
          />
        ))}
        {decoded.map((c) => (
          <CodeLabel key={`label-${c.code}`} bounds={c} isDark={isDark} />
        ))}
      </MapContainer>
    </div>
  );
}
