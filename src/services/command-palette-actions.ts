/**
 * Canonical command-palette catalogue.
 *
 * The ids deliberately match the renderer/native menu action ids. Keeping
 * metadata here makes the palette a second entry point to the same router,
 * instead of a separate collection of editor behaviours that can drift.
 */

export const COMMAND_CATEGORIES = [
  'file',
  'edit',
  'paragraph',
  'format',
  'view',
  'window',
  'help',
] as const

export type CommandCategory = typeof COMMAND_CATEGORIES[number]
export type CommandAvailability = 'always' | 'document' | 'wysiwyg'

export interface BuiltinCommandSpec {
  id: string
  category: CommandCategory
  labelKey: string
  availability: CommandAvailability
}

const command = (
  id: string,
  category: CommandCategory,
  availability: CommandAvailability = 'always',
): BuiltinCommandSpec => ({
  id,
  category,
  labelKey: `command.actions.${id}`,
  availability,
})

export const BUILTIN_COMMAND_SPECS: readonly BuiltinCommandSpec[] = [
  command('file.new', 'file'),
  command('file.newWindow', 'file'),
  command('file.open', 'file'),
  command('file.openFolder', 'file'),
  command('file.save', 'file', 'document'),
  command('file.saveAs', 'file', 'document'),
  command('file.saveAll', 'file', 'document'),
  command('file.exportHtml', 'file', 'document'),
  command('file.exportDocx', 'file', 'document'),
  command('file.exportOdt', 'file', 'document'),
  command('file.exportEpub', 'file', 'document'),
  command('file.print', 'file', 'document'),
  command('file.preferences', 'file'),
  command('file.closeTab', 'file', 'document'),
  command('file.closeWindow', 'file'),

  command('edit.find', 'edit', 'document'),
  command('edit.replace', 'edit', 'document'),
  command('edit.undo', 'edit', 'document'),
  command('edit.redo', 'edit', 'document'),
  command('edit.selectAll', 'edit', 'document'),
  command('edit.copyAsMarkdown', 'edit', 'wysiwyg'),
  command('edit.copyAsHtml', 'edit', 'wysiwyg'),
  command('edit.pasteAsPlainText', 'edit', 'wysiwyg'),

  command('paragraph.h1', 'paragraph', 'wysiwyg'),
  command('paragraph.h2', 'paragraph', 'wysiwyg'),
  command('paragraph.h3', 'paragraph', 'wysiwyg'),
  command('paragraph.h4', 'paragraph', 'wysiwyg'),
  command('paragraph.h5', 'paragraph', 'wysiwyg'),
  command('paragraph.h6', 'paragraph', 'wysiwyg'),
  command('paragraph.paragraph', 'paragraph', 'wysiwyg'),
  command('paragraph.blockquote', 'paragraph', 'wysiwyg'),
  command('paragraph.unorderedList', 'paragraph', 'wysiwyg'),
  command('paragraph.orderedList', 'paragraph', 'wysiwyg'),
  command('paragraph.taskList', 'paragraph', 'wysiwyg'),
  command('paragraph.codeBlock', 'paragraph', 'wysiwyg'),
  command('paragraph.table', 'paragraph', 'wysiwyg'),
  command('paragraph.horizontalRule', 'paragraph', 'wysiwyg'),

  command('format.bold', 'format', 'wysiwyg'),
  command('format.italic', 'format', 'wysiwyg'),
  command('format.strikethrough', 'format', 'wysiwyg'),
  command('format.inlineCode', 'format', 'wysiwyg'),
  command('format.link', 'format', 'wysiwyg'),
  command('format.image', 'format', 'wysiwyg'),
  command('format.clear', 'format', 'wysiwyg'),

  command('view.toggleSidebar', 'view'),
  command('view.toggleTabBar', 'view'),
  command('view.toggleToolbar', 'view'),
  command('view.toggleStatusBar', 'view'),
  command('view.toggleSourceCode', 'view', 'document'),
  command('view.toggleTypewriter', 'view', 'document'),
  command('view.toggleFocus', 'view', 'document'),
  command('view.commandPalette', 'view'),
  command('view.zoomIn', 'view'),
  command('view.zoomOut', 'view'),
  command('view.zoomReset', 'view'),

  command('window.alwaysOnTop', 'window'),
  command('window.fullscreen', 'window'),

  command('help.about', 'help'),
  command('help.openDocs', 'help'),
  command('help.openIssues', 'help'),
  command('help.checkForUpdates', 'help'),
]

export const BUILTIN_COMMAND_IDS = BUILTIN_COMMAND_SPECS.map(spec => spec.id)

export function commandCategoryOrder(category: CommandCategory): number {
  return COMMAND_CATEGORIES.indexOf(category)
}
