import config from '../runtimeConfig.js';

const CALLBACK_NAME = '__gmaps2DMapInit';
const API_KEY = config.googleApiKey ?? '';

let mapsPromise = null;

/** True when client/config.json has a non-placeholder Maps JS key. */
export function hasValidGoogleMapsKey() {
  const key = (API_KEY || '').trim();
  if (!key) return false;
  if (key.includes('YOUR_') || key.includes('CHANGE_ME') || key === 'null') return false;
  // Google browser keys are typically AIza... (39 chars); accept any long non-placeholder string.
  return key.length >= 20;
}

/**
 * Dynamically load the Google Maps JavaScript API if it is not already present.
 */
export function loadGoogleMaps() {
  if (mapsPromise) return mapsPromise;

  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in a browser'));
  }

  if (window.google?.maps?.Map) {
    mapsPromise = Promise.resolve(window.google.maps);
    return mapsPromise;
  }

  if (!hasValidGoogleMapsKey()) {
    mapsPromise = Promise.reject(
      new Error('Missing or placeholder googleApiKey in client/config.json (need a real Maps JavaScript API key)'),
    );
    return mapsPromise;
  }

  mapsPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete window[CALLBACK_NAME];
      mapsPromise = null;
      reject(new Error('Google Maps JavaScript API load timed out'));
    }, 15000);

    window[CALLBACK_NAME] = () => {
      clearTimeout(timeout);
      delete window[CALLBACK_NAME];
      if (window.google?.maps?.Map) {
        resolve(window.google.maps);
      } else {
        mapsPromise = null;
        reject(new Error('Google Maps initialized but Map is unavailable'));
      }
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&callback=${CALLBACK_NAME}&loading=async&libraries=places`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      delete window[CALLBACK_NAME];
      mapsPromise = null;
      reject(new Error('Failed to load Google Maps JavaScript API'));
    };
    document.head.appendChild(script);
  });

  return mapsPromise;
}
