import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
// world-atlas: TopoJSON dos países (110m). Vem embutido no bundle — sem CDN.
import countries110m from "world-atlas/countries-110m.json";

export interface GeoPoint {
  city: string;
  uf: string;
  lat: number;
  lon: number;
  online: number;
}

interface BrazilGeo {
  br: Feature<Geometry>;
  neighbours: Feature<Geometry>[];
}

let cached: BrazilGeo | null = null;
function getBrazilGeo(): BrazilGeo {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = countries110m as any;
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>;
  const br = fc.features.find(
    (f) => f.properties && (f.properties as { name?: string }).name === "Brazil"
  )!;
  const neighbours = fc.features.filter((f) => f !== br);
  cached = { br, neighbours };
  return cached;
}

/** Mapa do Brasil com pontos de luz proporcionais a quem está online agora. */
export function BrazilLiveMap({
  points,
  height = 420,
}: {
  points: GeoPoint[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(620);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const { br, neighbours } = getBrazilGeo();
  const W = width;
  const H = height;

  const { path, projected } = useMemo(() => {
    const projection = geoMercator().fitExtent(
      [
        [26, 22],
        [W - 26, H - 22],
      ],
      br as never
    );
    const pathGen = geoPath(projection);
    const sorted = points.slice().sort((a, b) => b.online - a.online);
    const max = Math.max(1, ...sorted.map((p) => p.online));
    const projected = sorted
      .map((p) => {
        const xy = projection([p.lon, p.lat]);
        if (!xy) return null;
        return { ...p, x: xy[0], y: xy[1], r: 3 + 11 * Math.sqrt(p.online / max), max };
      })
      .filter((p): p is NonNullable<typeof p> => p != null);
    return {
      path: {
        neighbours: neighbours.map((n) => pathGen(n) ?? ""),
        br: pathGen(br as never) ?? "",
        graticule: pathGen(geoGraticule10()) ?? "",
      },
      projected,
    };
  }, [br, neighbours, W, H, points]);

  const total = points.reduce((a, p) => a + p.online, 0);

  return (
    <div ref={ref} style={{ width: "100%", height }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block" }}>
        <defs>
          <filter id="blm-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="blm-fill">
            <stop offset="0%" stopColor="hsl(217 91% 30%)" />
            <stop offset="100%" stopColor="hsl(222 47% 12%)" />
          </radialGradient>
        </defs>

        <path d={path.graticule} fill="none" stroke="hsl(217 33% 20%)" strokeWidth={0.4} />

        {path.neighbours.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="hsl(222 47% 9%)"
            stroke="hsl(217 33% 18%)"
            strokeWidth={0.6}
          />
        ))}

        <path
          d={path.br}
          fill="url(#blm-fill)"
          stroke="hsl(217 91% 62%)"
          strokeWidth={1.4}
          strokeOpacity={0.85}
        />

        {projected.map((p, i) => {
          const dur = 2.4 + (i % 5) * 0.35;
          return (
            <g key={`${p.city}-${p.uf}`} transform={`translate(${p.x},${p.y})`}>
              <circle
                r={p.r}
                fill="hsl(0 84% 60%)"
                fillOpacity={0.18}
                stroke="hsl(0 84% 60%)"
                strokeWidth={1}
                strokeOpacity={0.5}
              >
                <animate
                  attributeName="r"
                  values={`${p.r};${p.r * 1.9};${p.r}`}
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="fill-opacity"
                  values="0.28;0.04;0.28"
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                />
              </circle>
              <circle r={Math.max(2.2, p.r * 0.42)} fill="hsl(0 84% 68%)" filter="url(#blm-glow)" />
              <title>{`${p.city} (${p.uf}) · ${p.online} pessoas agora`}</title>
              {p.online >= p.max * 0.45 && (
                <text
                  x={p.r + 7}
                  y={4}
                  fill="hsl(210 40% 92%)"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {`${p.city} · ${p.online}`}
                </text>
              )}
            </g>
          );
        })}

        <text
          x={26}
          y={H - 16}
          fill="hsl(215 20% 65%)"
          fontSize={11}
          fontFamily="Inter, system-ui, sans-serif"
        >
          {`${total} pessoas agora em ${projected.length} praças`}
        </text>
      </svg>
    </div>
  );
}
