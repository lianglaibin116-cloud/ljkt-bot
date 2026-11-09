/** Bound streamed JSON before allocating/parsing a user-supplied course snapshot. */
export async function readCourseDocumentJson(req: Request): Promise<unknown> {
  const max = 3_000_000;
  if (Number(req.headers.get('content-length')) > max)
    throw new RangeError('课程内容过大，请分成较短的课程整理。');
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError('请求内容为空。');
  let bytes = 0;
  const decoder = new TextDecoder();
  let value = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        throw new RangeError('课程内容过大，请分成较短的课程整理。');
      }
      value += decoder.decode(next.value, { stream: true });
    }
    value += decoder.decode();
    return JSON.parse(value);
  } finally {
    reader.releaseLock();
  }
}
