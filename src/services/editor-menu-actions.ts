/**
 * Translate native menu action ids into the command values understood by
 * Muya. Native menu ids deliberately describe user-facing actions while Muya
 * uses its own internal block/mark names, so keeping this translation
 * explicit prevents the two vocabularies from silently drifting apart.
 */
export const PARAGRAPH_MENU_COMMANDS = {
  'paragraph.h1': 'heading 1',
  'paragraph.h2': 'heading 2',
  'paragraph.h3': 'heading 3',
  'paragraph.h4': 'heading 4',
  'paragraph.h5': 'heading 5',
  'paragraph.h6': 'heading 6',
  'paragraph.paragraph': 'paragraph',
  'paragraph.blockquote': 'blockquote',
  'paragraph.unorderedList': 'ul-bullet',
  'paragraph.orderedList': 'ol-order',
  'paragraph.taskList': 'ul-task',
  'paragraph.codeBlock': 'pre',
  'paragraph.horizontalRule': 'hr',
} as const

export const FORMAT_MENU_COMMANDS = {
  'format.bold': 'strong',
  'format.italic': 'em',
  'format.strikethrough': 'del',
  'format.inlineCode': 'inline_code',
  'format.link': 'link',
  'format.image': 'image',
  'format.clear': 'clear',
} as const

export type EditorMenuCommand =
  | { kind: 'paragraph'; value: typeof PARAGRAPH_MENU_COMMANDS[keyof typeof PARAGRAPH_MENU_COMMANDS] }
  | { kind: 'format'; value: typeof FORMAT_MENU_COMMANDS[keyof typeof FORMAT_MENU_COMMANDS] }
  | { kind: 'table' }

export function resolveEditorMenuCommand(id: string): EditorMenuCommand | null {
  if (id === 'paragraph.table') return { kind: 'table' }

  if (Object.hasOwn(PARAGRAPH_MENU_COMMANDS, id)) {
    return {
      kind: 'paragraph',
      value: PARAGRAPH_MENU_COMMANDS[id as keyof typeof PARAGRAPH_MENU_COMMANDS],
    }
  }

  if (Object.hasOwn(FORMAT_MENU_COMMANDS, id)) {
    return {
      kind: 'format',
      value: FORMAT_MENU_COMMANDS[id as keyof typeof FORMAT_MENU_COMMANDS],
    }
  }

  return null
}
