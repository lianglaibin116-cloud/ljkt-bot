/**
 * Older saved documents may contain general teaching caveats in `warnings`.
 * Show only a concrete course error or a document completeness failure.
 */
export function actionableCourseDocumentWarnings(warnings: readonly string[]): string[] {
  const sourceReference = /第\s*\d+\s*页|page\s*\d+|原页面|课件|source page/i;
  const concreteIssue =
    /矛盾|冲突|不一致|错误|有误|不正确|不安全|危险|安全风险|安全隐患|contradict|conflict|inconsisten|incorrect|unsafe|factual error/i;
  const statedContradiction = /同时出现[^。]*和[^。]*的表述/;
  const incompleteDocument =
    /答案或解析资料不足|缺少可读教学内容|仅有外部互动链接|未完整整理|answer or explanation (?:is )?missing|unreadable teaching content/i;
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))].filter(
    (warning) =>
      (sourceReference.test(warning) && concreteIssue.test(warning)) ||
      statedContradiction.test(warning) ||
      incompleteDocument.test(warning),
  );
}
