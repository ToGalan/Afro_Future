import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface PreviewTarget { file: string; rect: DOMRect; persistent: boolean; key: number; }

interface Ctx {
  setCardPreview: (file: string, el: HTMLElement | null, persistent?: boolean) => void;
  clearIfTransient: (file: string) => void;
}

const PreviewContext = createContext<Ctx | null>(null);

export const useSharedPreview = () => {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error('useSharedPreview must be used within <SharedVariantPreviewProvider>');
  return ctx;
};

export function SharedVariantPreviewProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const keyRef = useRef(0);

  const setCardPreview = useCallback((file: string, el: HTMLElement | null, persistent = false) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    keyRef.current += 1;
    setTarget({ file, rect, persistent, key: keyRef.current });
  }, []);

  const clearIfTransient = useCallback((file: string) => {
    setTarget(cur => {
      if (cur && cur.file === file && !cur.persistent) return null;
      return cur;
    });
  }, []);

  // Recompute rect on resize/scroll
  useEffect(() => {
    if (!target) return;
    const handle = () => {
      const cards = document.querySelectorAll('[data-variant-card]');
      cards.forEach(el => {
        if (el.getAttribute('data-file') === target.file) {
          const r = el.getBoundingClientRect();
          setTarget(t => t ? { ...t, rect: r } : t);
        }
      });
    };
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [target]);

  return (
    <div ref={containerRef} className="relative">
      <PreviewContext.Provider value={{ setCardPreview, clearIfTransient }}>
        {children}
        {target && (
          <OverlayCanvas target={target} container={containerRef} />
        )}
      </PreviewContext.Provider>
    </div>
  );
}

function OverlayCanvas({ target, container }: { target: PreviewTarget; container: React.RefObject<HTMLDivElement> }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 15); // small delay to avoid thrash
    return () => clearTimeout(t);
  }, [target.key]);
  if (!ready) return null;
  const cRect = container.current?.getBoundingClientRect();
  if (!cRect) return null;
  const left = target.rect.left - cRect.left;
  const top = target.rect.top - cRect.top;
  const style: React.CSSProperties = {
    position: 'absolute',
    left, top,
    width: target.rect.width,
    height: target.rect.height,
    pointerEvents: 'none',
    zIndex: 30,
  };
  return (
    <div style={style}>
      <Canvas dpr={0.9} camera={{ position: [0.9,0.9,0.9], fov:34 }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[1.2,2,2]} intensity={0.65} />
        <SingleRotator file={target.file} />
      </Canvas>
    </div>
  );
}

function SingleRotator({ file }: { file: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_s, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.4; });
  return (
    <group ref={ref}>
      <FitModel url={`/assets/3d/${file}`} />
    </group>
  );
}

function FitModel({ url }: { url: string }) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(url) as any;
  const clone = React.useMemo(() => scene.clone(true), [scene]);
  const { invalidate } = useThree();
  useEffect(() => {
    if (!group.current) return;
    const bbox = new THREE.Box3().setFromObject(group.current);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    group.current.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 1.35 / maxDim : 1;
    group.current.scale.setScalar(scale);
    invalidate();
  }, [clone, invalidate]);
  return <group ref={group}>{<primitive object={clone} />}</group>;
}

useGLTF.preload('/assets/3d/Hair.001.glb');
