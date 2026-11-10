'use strict';

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 8_000]);
const STOP_TIMEOUT_MS = 5_000;

/** Owns the local course server and restarts it after an unexpected exit. */
function createServerSupervisor({
  start,
  waitReady,
  stop,
  onReady = () => {},
  onUnavailable = () => {},
  onExhausted = () => {},
  log = () => {},
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
}) {
  let current = null;
  let currentExit = null;
  let ready = false;
  let stopping = false;
  let retryAttempt = 0;
  let retryTimer = null;
  let recoveryPromise = null;

  const isCurrent = (process) => !stopping && current === process;

  function observe(process) {
    let resolveExit;
    const exitPromise = new Promise((resolve) => {
      resolveExit = resolve;
    });
    current = process;
    currentExit = { process, promise: exitPromise };
    ready = false;
    process.once('exit', (code) => {
      resolveExit(code);
      if (current !== process) return;
      const wasReady = ready;
      current = null;
      currentExit = null;
      ready = false;
      onUnavailable({ code, process });
      if (wasReady && !stopping) scheduleRecovery();
    });
  }

  async function stopOwned(process) {
    const observed = currentExit?.process === process ? currentExit.promise : null;
    await stop(process);
    if (!observed || current !== process) return;
    const exited = await Promise.race([
      observed.then(() => true),
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    if (!exited && current === process) {
      throw new Error('本机课程服务未能退出；为避免启动重复服务，已停止自动重启。');
    }
  }

  async function launch(recovering) {
    if (stopping || current) return null;
    let process;
    try {
      process = start();
      if (!process || typeof process.once !== 'function') {
        throw new Error('本机课程服务没有返回可管理的进程。');
      }
      observe(process);
      await waitReady(process, () => isCurrent(process));
      if (!isCurrent(process)) throw new Error('本机课程服务在启动期间退出。');
      ready = true;
      retryAttempt = 0;
      onReady(process, { recovered: recovering });
      return process;
    } catch (error) {
      if (process && current === process) {
        try {
          await stopOwned(process);
        } catch (stopError) {
          log(stopError.message);
          if (recovering) onExhausted(stopError);
          throw stopError;
        }
      }
      if (recovering && !stopping) scheduleRecovery();
      throw error;
    }
  }

  function scheduleRecovery() {
    if (stopping || current || retryTimer) return;
    if (retryAttempt >= retryDelaysMs.length) {
      const error = new Error('本机课程服务多次重启仍未恢复。');
      log(error.message);
      onExhausted(error);
      return;
    }
    const delay = retryDelaysMs[retryAttempt++];
    log(`本机课程服务将在 ${delay}ms 后尝试恢复（${retryAttempt}/${retryDelaysMs.length}）。`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (stopping || current || recoveryPromise) return;
      recoveryPromise = launch(true)
        .catch((error) => log(`本机课程服务恢复失败：${error.message}`))
        .finally(() => {
          recoveryPromise = null;
        });
    }, delay);
    retryTimer.unref?.();
  }

  async function startInitial() {
    if (current || stopping) throw new Error('本机课程服务监督器已启动或已关闭。');
    return launch(false);
  }

  async function shutdown() {
    stopping = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    const process = current;
    if (!process) return;
    await stopOwned(process);
  }

  return {
    start: startInitial,
    shutdown,
    isCurrent,
    get process() {
      return current;
    },
  };
}

module.exports = { createServerSupervisor };
