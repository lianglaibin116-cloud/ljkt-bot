/** Return from an embedded Bot course to the conversation that opened it. */
export function returnToBotChatIfEmbedded(): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false;
  if (new URLSearchParams(window.location.search).get('botEmbedded') !== '1') return false;
  window.parent.postMessage({ type: 'ljkt-bot:return-to-chat' }, window.location.origin);
  return true;
}
