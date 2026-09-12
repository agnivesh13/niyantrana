/**
 * The Google sign-in button, rendered by Google Identity Services.
 *
 * Google renders the button itself, inside its own iframe, and hands back a
 * signed ID token. That is the point: the token is the only thing that crosses
 * into this app, and it is verified server-side against Google's public keys.
 * Nothing about the signed-in user is taken from the browser's word.
 *
 * `VITE_GOOGLE_CLIENT_ID` is public by design — a client ID is not a secret,
 * and Google's own docs put it in page source. The client *secret* never leaves
 * the server.
 *
 * Renders nothing when the client ID is unset, so a deployment without Google
 * configured shows a working password form rather than a dead button.
 */
import { useEffect, useRef, useState } from 'react';

import { Alert } from '../ui/primitives.jsx';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** Load the GIS script once, however many buttons ask for it. */
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();

  const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('load failed')), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('load failed')), { once: true });
    document.head.appendChild(script);
  });
}

export default function GoogleSignInButton({ onCredential, text = 'continue_with' }) {
  const slot = useRef(null);
  const [failed, setFailed] = useState(false);
  // Held in a ref so re-rendering the parent does not re-initialise GIS with a
  // stale callback closure.
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID) return undefined;

    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !slot.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => handler.current?.(response.credential),
        });
        window.google.accounts.id.renderButton(slot.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text,
          logo_alignment: 'center',
          width: 320,
        });
      })
      .catch(() => {
        // A blocked script or an offline browser. Say so rather than leaving an
        // empty space where a button should be.
        if (!cancelled) setFailed(true);
      });

    return () => { cancelled = true; };
  }, [text]);

  if (!CLIENT_ID) return null;

  if (failed) {
    return (
      <Alert tone="warning">
        Google sign-in could not load. Use your email and password below.
      </Alert>
    );
  }

  // min-height reserves the button's space so the form does not jump when
  // Google's iframe finishes loading.
  return <div ref={slot} className="flex min-h-[44px] justify-center" />;
}

export const googleSignInAvailable = Boolean(CLIENT_ID);
