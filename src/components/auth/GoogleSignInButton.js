import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { getGoogleClientId, initGoogleIdentity } from '../../services/googleIdentity';
// Handles loading of the Google Identity script exactly once and then renders a placeholder div replaced by GIS.
export const GoogleSignInButton = ({ clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID, onCredential, text = 'signin_with', theme = 'outline', size = 'large', width = 260, shape = 'rectangular', logoAlignment = 'left', autoSelect = false, className = '', disabled = false, }) => {
    const divRef = React.useRef(null);
    const loadedRef = window._gisLoadedRef || (window._gisLoadedRef = { loaded: false, callbacks: [] });
    React.useEffect(() => {
        if (disabled)
            return;
        async function run() {
            const cid = clientId || await getGoogleClientId();
            if (!cid) {
                if (divRef.current) {
                    divRef.current.innerHTML = `<div style="padding:12px 16px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);font-size:11px;text-align:center;">Google Sign-In unavailable<br/><small>Missing googleClientId (config.json or env)</small></div>`;
                }
                return;
            }
            function init() {
                if (!divRef.current)
                    return;
                // @ts-ignore
                if (window.google?.accounts?.id) {
                    initGoogleIdentity(cid, (resp) => { if (resp.credential)
                        onCredential(resp.credential); });
                    // @ts-ignore
                    window.google.accounts.id.renderButton(divRef.current, {
                        type: 'standard',
                        theme,
                        size,
                        width,
                        text,
                        shape,
                        logo_alignment: logoAlignment,
                    });
                }
            }
            if (loadedRef.loaded) {
                init();
            }
            else {
                loadedRef.callbacks.push(init);
                if (!document.getElementById('gis-sdk')) {
                    const s = document.createElement('script');
                    s.id = 'gis-sdk';
                    s.src = 'https://accounts.google.com/gsi/client';
                    s.async = true;
                    s.defer = true;
                    s.onload = () => {
                        loadedRef.loaded = true;
                        loadedRef.callbacks.forEach((cb) => cb());
                        loadedRef.callbacks = [];
                    };
                    document.head.appendChild(s);
                }
            }
        }
        run();
    }, [clientId, autoSelect, disabled, text, theme, size, width, shape, logoAlignment, onCredential, loadedRef]);
    return _jsx("div", { className: className, ref: divRef });
};
export default GoogleSignInButton;
