import React from 'react';
import { getGoogleClientId, initGoogleIdentity } from '../../services/googleIdentity';

interface GoogleSignInButtonProps {
  clientId?: string; // from env
  onCredential: (token: string) => void;
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signup' | 'signin';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  width?: number;
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logoAlignment?: 'left' | 'center';
  autoSelect?: boolean;
  className?: string;
  disabled?: boolean;
}

// Handles loading of the Google Identity script exactly once and then renders a placeholder div replaced by GIS.
export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID,
  onCredential,
  text = 'signin_with',
  theme = 'outline',
  size = 'large',
  width = 260,
  shape = 'rectangular',
  logoAlignment = 'left',
  autoSelect = false,
  className = '',
  disabled = false,
}) => {
  const divRef = React.useRef<HTMLDivElement | null>(null);
  const loadedRef = (window as any)._gisLoadedRef || ((window as any)._gisLoadedRef = { loaded: false, callbacks: [] as (()=>void)[] });

  React.useEffect(() => {
    if (disabled) return;

    async function run(){
      const cid = clientId || await getGoogleClientId();
      if(!cid){
        if (divRef.current) {
          divRef.current.innerHTML = `<div style="padding:12px 16px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);font-size:11px;text-align:center;">Google Sign-In unavailable<br/><small>Missing googleClientId (config.json or env)</small></div>`;
        }
        return;
      }

      function init() {
        if (!divRef.current) return;
        // @ts-ignore
        if (window.google?.accounts?.id) {
          initGoogleIdentity(cid as string, (resp:any)=>{ if(resp.credential) onCredential(resp.credential); });
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
      } else {
        loadedRef.callbacks.push(init);
        if (!document.getElementById('gis-sdk')) {
          const s = document.createElement('script');
          s.id = 'gis-sdk';
          s.src = 'https://accounts.google.com/gsi/client';
          s.async = true; s.defer = true;
          s.onload = () => {
            loadedRef.loaded = true;
            loadedRef.callbacks.forEach((cb: () => void) => cb());
            loadedRef.callbacks = [];
          };
          document.head.appendChild(s);
        }
      }
    }
    run();
  }, [clientId, autoSelect, disabled, text, theme, size, width, shape, logoAlignment, onCredential, loadedRef]);

  return <div className={className} ref={divRef} />;
};

export default GoogleSignInButton;
