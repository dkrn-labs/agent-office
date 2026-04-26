/**
 * Boot-time hook installer. Iterates registered adapters, invoking
 * `installHook()` per provider in parallel. Failures are logged and
 * swallowed — a missing CLI shouldn't crash boot.
 */

const noopLog = { warn: () => {}, info: () => {} };

/**
 * @param {Array<{ id: string, installHook?: Function }>} adapters
 * @param {{ log?: { warn: Function, info?: Function }, hookInstallOpts?: object }} [opts]
 * @returns {Promise<Array<object>>}  Results from successful installs.
 */
export async function installHooksForAdapters(adapters, { log = noopLog, hookInstallOpts } = {}) {
  const installable = (adapters ?? []).filter((a) => typeof a?.installHook === 'function');
  const settled = await Promise.allSettled(
    installable.map((a) => a.installHook(hookInstallOpts ?? {})),
  );
  const results = [];
  for (let i = 0; i < settled.length; i++) {
    const adapter = installable[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      results.push(r.value);
      if (r.value?.changed) log.info?.(`[hooks] installed ${adapter.id} → ${r.value.path}`);
    } else {
      log.warn(`[hooks] ${adapter.id} install failed: ${r.reason?.message ?? r.reason}`);
    }
  }
  return results;
}
