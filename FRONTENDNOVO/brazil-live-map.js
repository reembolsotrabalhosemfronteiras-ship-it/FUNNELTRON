// <brazil-live-map points='[{city,uf,lat,lon,online}]'> — Brasil real (world-atlas
// via d3-geo) com pontos de luz proporcionais a quem está online agora.
(function () {
  const GEO = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
  let brazilPromise = null;

  function loadBrazil() {
    if (!brazilPromise) {
      brazilPromise = fetch(GEO)
        .then((r) => r.json())
        .then((topo) => {
          const fc = topojson.feature(topo, topo.objects.countries);
          const br = fc.features.find((f) => f.properties && f.properties.name === 'Brazil');
          const neighbours = fc.features.filter((f) => f !== br);
          return { br, neighbours };
        });
    }
    return brazilPromise;
  }

  function ready() {
    return new Promise((resolve) => {
      const tick = () => {
        if (window.d3 && window.topojson) resolve();
        else setTimeout(tick, 60);
      };
      tick();
    });
  }

  class BrazilLiveMap extends HTMLElement {
    connectedCallback() { this.render(); }
    static get observedAttributes() { return ['points']; }
    attributeChangedCallback() { if (this.isConnected) this.render(); }

    get points() {
      try { return JSON.parse(this.getAttribute('points') || '[]'); } catch (e) { return []; }
    }

    async render() {
      if (this._rendering) return;
      this._rendering = true;
      await ready();
      const { br, neighbours } = await loadBrazil();
      this._rendering = false;

      const W = this.clientWidth || 620, H = this.clientHeight || 420;
      const pts = this.points.slice().sort((a, b) => b.online - a.online);
      const total = pts.reduce((a, p) => a + p.online, 0);
      const max = Math.max(1, ...pts.map((p) => p.online));

      this.innerHTML = '';
      const svg = d3.select(this).append('svg')
        .attr('viewBox', '0 0 ' + W + ' ' + H)
        .attr('width', '100%').attr('height', '100%')
        .style('display', 'block');

      const defs = svg.append('defs');
      const glow = defs.append('filter').attr('id', 'blm-glow')
        .attr('x', '-120%').attr('y', '-120%').attr('width', '340%').attr('height', '340%');
      glow.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'b');
      const merge = glow.append('feMerge');
      merge.append('feMergeNode').attr('in', 'b');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');

      const grad = defs.append('radialGradient').attr('id', 'blm-fill');
      grad.append('stop').attr('offset', '0%').attr('stop-color', 'hsl(217 91% 30%)');
      grad.append('stop').attr('offset', '100%').attr('stop-color', 'hsl(222 47% 12%)');

      const projection = d3.geoMercator().fitExtent([[26, 22], [W - 26, H - 22]], br);
      const path = d3.geoPath(projection);

      svg.append('g').selectAll('path').data(neighbours).join('path')
        .attr('d', path)
        .attr('fill', 'hsl(222 47% 9%)')
        .attr('stroke', 'hsl(217 33% 18%)')
        .attr('stroke-width', 0.6);

      svg.append('path').datum(br)
        .attr('d', path)
        .attr('fill', 'url(#blm-fill)')
        .attr('stroke', 'hsl(217 91% 62%)')
        .attr('stroke-width', 1.4)
        .attr('stroke-opacity', 0.85);

      // grade de meridianos discreta, só para dar profundidade de "globo"
      svg.insert('path', ':first-child').datum(d3.geoGraticule10())
        .attr('d', path).attr('fill', 'none')
        .attr('stroke', 'hsl(217 33% 20%)').attr('stroke-width', 0.4);

      const g = svg.append('g');
      pts.forEach((p, i) => {
        const xy = projection([p.lon, p.lat]);
        if (!xy) return;
        const r = 3 + 11 * Math.sqrt(p.online / max);
        const node = g.append('g').attr('transform', 'translate(' + xy[0] + ',' + xy[1] + ')');

        const halo = node.append('circle')
          .attr('r', r).attr('fill', 'hsl(0 84% 60%)').attr('fill-opacity', 0.18)
          .attr('stroke', 'hsl(0 84% 60%)').attr('stroke-width', 1).attr('stroke-opacity', 0.5);

        node.append('circle')
          .attr('r', Math.max(2.2, r * 0.42))
          .attr('fill', 'hsl(0 84% 68%)')
          .attr('filter', 'url(#blm-glow)');

        halo.append('animate')
          .attr('attributeName', 'r')
          .attr('values', r + ';' + (r * 1.9) + ';' + r)
          .attr('dur', (2.4 + (i % 5) * 0.35) + 's')
          .attr('repeatCount', 'indefinite');
        halo.append('animate')
          .attr('attributeName', 'fill-opacity')
          .attr('values', '0.28;0.04;0.28')
          .attr('dur', (2.4 + (i % 5) * 0.35) + 's')
          .attr('repeatCount', 'indefinite');

        node.append('title').text(p.city + ' (' + p.uf + ') · ' + p.online + ' pessoas agora');

        if (p.online >= max * 0.45) {
          node.append('text')
            .attr('x', r + 7).attr('y', 4)
            .attr('fill', 'hsl(210 40% 92%)')
            .attr('font-size', 11).attr('font-weight', 600)
            .attr('font-family', 'Inter, system-ui, sans-serif')
            .text(p.city + ' · ' + p.online);
        }
      });

      svg.append('text')
        .attr('x', 26).attr('y', H - 16)
        .attr('fill', 'hsl(215 20% 65%)').attr('font-size', 11)
        .attr('font-family', 'Inter, system-ui, sans-serif')
        .text(total + ' pessoas agora em ' + pts.length + ' praças');
    }
  }

  if (!customElements.get('brazil-live-map')) customElements.define('brazil-live-map', BrazilLiveMap);
})();
