import strongIcon from '../../assets/pngicon/format_strong/2.png'
import emphasisIcon from '../../assets/pngicon/format_emphasis/2.png'
import underlineIcon from '../../assets/pngicon/format_underline/2.png'
import codeIcon from '../../assets/pngicon/code/2.png'
import imageIcon from '../../assets/pngicon/format_image/2.png'
import linkIcon from '../../assets/pngicon/format_link/2.png'
import strikeIcon from '../../assets/pngicon/format_strike/2.png'
import mathIcon from '../../assets/pngicon/format_math/2.png'
import highlightIcon from '../../assets/pngicon/highlight/2.png'
import clearIcon from '../../assets/pngicon/format_clear/2.png'
import {
  currentShortcutPlatform,
  displayAccelerator,
  getShortcutDefault,
} from '@/common/shortcut-registry'

const shortcutPlatform = currentShortcutPlatform()

const shortcut = actionId => {
  const accelerator = getShortcutDefault(actionId)
  return accelerator ? displayAccelerator(accelerator, shortcutPlatform) : undefined
}

const icons = [
  {
    type: 'strong',
    tooltip: 'Bold',
    shortcut: shortcut('format.bold'),
    icon: strongIcon
  }, {
    type: 'em',
    tooltip: 'Italic',
    shortcut: shortcut('format.italic'),
    icon: emphasisIcon
  }, {
    type: 'u',
    tooltip: 'Underline',
    icon: underlineIcon
  }, {
    type: 'del',
    tooltip: 'Strikethrough',
    shortcut: shortcut('format.strikethrough'),
    icon: strikeIcon
  }, {
    type: 'mark',
    tooltip: 'Highlight',
    icon: highlightIcon
  }, {
    type: 'inline_code',
    tooltip: 'Inline Code',
    shortcut: shortcut('format.inlineCode'),
    icon: codeIcon
  }, {
    type: 'inline_math',
    tooltip: 'Inline Math',
    icon: mathIcon
  }, {
    type: 'link',
    tooltip: 'Link',
    shortcut: shortcut('format.link'),
    icon: linkIcon
  }, {
    type: 'image',
    tooltip: 'Image',
    shortcut: shortcut('format.image'),
    icon: imageIcon
  }, {
    type: 'clear',
    tooltip: 'Clear Formatting',
    icon: clearIcon
  }
]

export default icons
