import exampleConfig from '../config.example.json';

// config.json is intentionally gitignored. Vite's glob keeps local builds
// working when the file has not been created yet, while still preferring it.
const localModules = import.meta.glob('../config.json', {
  eager: true,
  import: 'default',
});

const localConfig = localModules['../config.json'] || {};

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    openclaw: {
      ...(base.openclaw || {}),
      ...(override.openclaw || {}),
    },
  };
}

export default mergeConfig(exampleConfig, localConfig);
