import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
export function ScaleToFit({ children, className = '', baseWidth, baseHeight, origin = 'top-center' }) {
    const viewportRef = React.useRef(null);
    const innerRef = React.useRef(null);
    const [scale, setScale] = React.useState(1);
    const measure = React.useCallback(() => {
        const vp = viewportRef.current;
        const inner = innerRef.current;
        if (!vp || !inner)
            return;
        const vw = vp.clientWidth;
        const vh = vp.clientHeight;
        // When base sizes are provided, use them as natural size; else measure content box
        const iw = baseWidth ?? inner.scrollWidth;
        const ih = baseHeight ?? inner.scrollHeight;
        if (iw && ih && vw && vh)
            setScale(Math.min(vw / iw, vh / ih, 1));
        else
            setScale(1);
    }, [baseWidth, baseHeight]);
    React.useEffect(() => {
        const ro = new ResizeObserver(() => { requestAnimationFrame(measure); });
        if (viewportRef.current)
            ro.observe(viewportRef.current);
        if (innerRef.current)
            ro.observe(innerRef.current);
        window.addEventListener('resize', measure);
        measure();
        return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
    }, [measure]);
    const originStyle = origin === 'top-left' ? 'top left' : origin === 'center' ? 'center' : 'top center';
    return (_jsx("div", { ref: viewportRef, className: `relative overflow-hidden ${className}`, children: _jsx("div", { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: origin === 'top-left' ? 'start start' : origin === 'center' ? 'center' : 'start center', pointerEvents: 'none' }, children: _jsx("div", { style: { transform: `scale(${scale})`, transformOrigin: originStyle, pointerEvents: 'auto' }, children: _jsx("div", { ref: innerRef, style: { width: baseWidth, height: baseHeight }, children: children }) }) }) }));
}
export default ScaleToFit;
