import type { CourseDocumentKind, CourseDocumentSection } from './types';

// Match learning self-assessment headings, not experiment or task checklists.
const learningChecklist =
  /^(?:(?:修订|复习|学习|知识掌握)(?:检查|自查|核对)?清单|(?:学习|自我)?自查清单|(?:revision|review|learning|self[ -]assessment|self[ -]check) checklist)$/i;

function isLearningChecklist(title: string): boolean {
  return learningChecklist.test(title.replace(/[*_`]/g, '').trim());
}

/** Remove an old model-added subsection without losing the surrounding lesson content. */
function removeChecklistBlocks(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  let skippingLevel: number | undefined;
  let changed = false;
  for (const line of lines) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = undefined;
    } else if (!fence) {
      const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
      if (heading) {
        const level = heading[1].length;
        if (skippingLevel !== undefined && level <= skippingLevel) skippingLevel = undefined;
        if (skippingLevel === undefined && isLearningChecklist(heading[2])) {
          skippingLevel = level;
          changed = true;
        }
      }
    }
    if (skippingLevel === undefined) kept.push(line);
  }
  return changed ? kept.join('\n').trim() : content;
}

/** Shared by new generation and legacy document previews, editing and exports. */
export function withoutStudentChecklists<
  T extends { kind: CourseDocumentKind; sections: CourseDocumentSection[] },
>(document: T): T {
  if (document.kind !== 'student-notes') return document;
  const sections = document.sections.flatMap((section) => {
    if (section.id.startsWith('quiz-')) return [section];
    if (isLearningChecklist(section.title)) return [];
    const content = removeChecklistBlocks(section.content);
    if (!content.trim() && content !== section.content) return [];
    const title = section.title.replace(
      /(?:与|及|和|、)([^与及和、]+)$/,
      (suffix, label: string) => (isLearningChecklist(label) ? '' : suffix),
    );
    return [{ ...section, title, content }];
  });
  return { ...document, sections };
}
