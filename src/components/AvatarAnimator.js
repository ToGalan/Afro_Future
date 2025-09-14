import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFBX, useAnimations } from '@react-three/drei';
const AvatarAnimationContext = createContext(null);
export function useAvatarAnimation() {
    const ctx = useContext(AvatarAnimationContext);
    if (!ctx)
        throw new Error('useAvatarAnimation must be used inside <AvatarAnimator/>');
    return ctx;
}
// Paths (public). Adjust naming if actual files differ.
// To add additional animations (e.g. Run.fbx, Wave.fbx):
// 1. Place the FBX in /assets/3d.
// 2. Load with useFBX inside this component (or a higher-level loader) and merge animations arrays.
// 3. Expose clip names via `available` and create UI to select them.
const RIG_PATH = '/assets/3d/FullBody.fbx';
const IDLE_PATH = '/assets/3d/Idle.fbx';
export const AvatarAnimator = ({ children, speed = 1, paused = false, clip, onState }) => {
    // Attempt to load rig & idle; if fail, Drei will error to console. We keep try/catch nuance by conditional flags.
    // (Optional) If a separate rig FBX is needed later, load it similarly to Idle and parent children appropriately.
    const groupRef = useRef(null);
    // Load animation file (idle). We'll treat all contained animations (FBX typically one) as available.
    const idleFbx = useFBX(IDLE_PATH);
    const { animations } = idleFbx;
    const { actions, names } = useAnimations(animations, groupRef);
    const [current, setCurrent] = useState(() => clip || names[0]);
    const [playSpeed, setPlaySpeed] = useState(speed);
    const [isPaused, setIsPaused] = useState(paused);
    // Sync external prop changes
    useEffect(() => { setPlaySpeed(speed); }, [speed]);
    useEffect(() => { setIsPaused(paused); }, [paused]);
    // Play / update action when clip or pause/speed changes
    useEffect(() => {
        if (!current || !actions)
            return;
        const action = actions[current];
        if (!action)
            return;
        action.reset();
        action.setEffectiveTimeScale(isPaused ? 0 : playSpeed);
        action.setLoop(2200, Infinity); // typical LoopRepeat constant; numeric safeguard
        action.fadeIn(0.2).play();
        return () => {
            action.fadeOut(0.2);
        };
    }, [current, actions, isPaused, playSpeed]);
    const api = useMemo(() => ({
        play: (clipName) => {
            if (clipName && names.includes(clipName))
                setCurrent(clipName);
            setIsPaused(false);
        },
        pause: () => setIsPaused(true),
        setSpeed: (s) => setPlaySpeed(s),
        speed: playSpeed,
        current,
        available: names,
        paused: isPaused,
        root: groupRef,
    }), [current, names, playSpeed, isPaused]);
    // Emit state up
    useEffect(() => { onState?.({ current, paused: isPaused, speed: playSpeed }); }, [current, isPaused, playSpeed, onState]);
    return (_jsx(AvatarAnimationContext.Provider, { value: api, children: _jsx("group", { ref: groupRef, children: children }) }));
};
// Preload helper (optional call from app root)
export function preloadAvatarAnimation() {
    // Retained for any callers; main tiered scheduler already preloads these.
    useFBX.preload(IDLE_PATH);
    useFBX.preload(RIG_PATH);
}
