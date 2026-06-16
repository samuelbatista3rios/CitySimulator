import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGenesis } from '../state/store';

/**
 * Mapa de calor: quadrados coloridos sobre os quarteirões, segundo a métrica
 * ativa (riqueza, felicidade, crime, valor do imóvel). Os valores vêm agregados
 * por bloco da simulação e são normalizados aqui para a escala de cor.
 */
export function HeatmapOverlay() {
  const layout = useGenesis((s) => s.layout);
  const metric = useGenesis((s) => s.heatmapMetric);
  const heatmap = useGenesis((s) => s.heatmap);
  const refreshHeatmap = useGenesis((s) => s.refreshHeatmap);

  // atualiza os dados periodicamente enquanto a camada está ativa
  useEffect(() => {
    if (metric === 'none') return;
    refreshHeatmap();
    const id = setInterval(refreshHeatmap, 2500);
    return () => clearInterval(id);
  }, [metric, refreshHeatmap]);

  const mesh = useMemo(() => {
    if (!layout || metric === 'none' || !heatmap) return null;
    const values = heatmap[metric];
    if (!values) return null;
    const blocks = layout.blocks;
    // normalização sobre blocos com dado (>0)
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (v > 0) { if (v < min) min = v; if (v > max) max = v; } }
    if (!isFinite(min)) { min = 0; max = 1; }
    const span = max - min || 1;
    const size = layout.blockSpan - 3;
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.58, depthWrite: false });
    const im = new THREE.InstancedMesh(geo, mat, blocks.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (let i = 0; i < blocks.length; i++) {
      const v = values[i];
      const showZero = metric === 'crime'; // crime 0 = seguro (azul); demais escondem vazio
      if (v <= 0 && !showZero) continue;
      const t = Math.max(0, Math.min(1, (v - min) / span));
      col.setHSL((1 - t) * 0.66, 0.85, 0.5); // azul(baixo) → verde → amarelo → vermelho(alto)
      m.makeTranslation(blocks[i].x, (blocks[i].elevation ?? 0) + 0.45, blocks[i].z);
      im.setMatrixAt(n, m);
      im.setColorAt(n, col);
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }, [layout, metric, heatmap]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
