import { useMemo } from 'react';
import type { BuildingId } from '../../config/buildings';
import type { Appearance } from '../../config/villagers';
import { thumbnails } from '../../rendering/Thumbnails';

export function Portrait({ appearance, size = 44, ring }: { appearance: Appearance; size?: number; ring?: 'idle' | 'warn' | null }) {
  const src = useMemo(() => thumbnails.portrait(appearance), [appearance]);
  return (
    <span className={`portrait ${ring ? `ring-${ring}` : ''}`} style={{ width: size, height: size, background: appearance.shirt }}>
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

export function BuildingThumb({ id, size = 64 }: { id: BuildingId; size?: number }) {
  const src = useMemo(() => thumbnails.building(id), [id]);
  return <span className="bthumb" style={{ width: size, height: size }}>{src ? <img src={src} alt="" draggable={false} /> : null}</span>;
}
