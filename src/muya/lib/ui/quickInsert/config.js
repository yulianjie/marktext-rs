import paragraphIcon from '../../assets/pngicon/paragraph/2.png'
import htmlIcon from '../../assets/pngicon/html/2.png'
import hrIcon from '../../assets/pngicon/horizontal_line/2.png'
import frontMatterIcon from '../../assets/pngicon/front_matter/2.png'
import header1Icon from '../../assets/pngicon/heading_1/2.png'
import header2Icon from '../../assets/pngicon/heading_2/2.png'
import header3Icon from '../../assets/pngicon/heading_3/2.png'
import header4Icon from '../../assets/pngicon/heading_4/2.png'
import header5Icon from '../../assets/pngicon/heading_5/2.png'
import header6Icon from '../../assets/pngicon/heading_6/2.png'
import newTableIcon from '../../assets/pngicon/new_table/2.png'
import bulletListIcon from '../../assets/pngicon/bullet_list/2.png'
import codeIcon from '../../assets/pngicon/code/2.png'
import quoteIcon from '../../assets/pngicon/quote_block/2.png'
import todoListIcon from '../../assets/pngicon/todolist/2.png'
import mathblockIcon from '../../assets/pngicon/math/2.png'
import orderListIcon from '../../assets/pngicon/order_list/2.png'
import flowchartIcon from '../../assets/pngicon/flowchart/2.png'
import sequenceIcon from '../../assets/pngicon/sequence/2.png'
import plantumlIcon from '../../assets/pngicon/plantuml/2.png'
import mermaidIcon from '../../assets/pngicon/mermaid/2.png'
import vegaIcon from '../../assets/pngicon/chart/2.png'
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

export const quickInsertObj = {
  'basic block': [{
    title: 'Paragraph',
    subTitle: 'Lorem Ipsum is simply dummy text',
    label: 'paragraph',
    icon: paragraphIcon
  }, {
    title: 'Horizontal Line',
    subTitle: '---',
    label: 'hr',
    icon: hrIcon
  }, {
    title: 'Front Matter',
    subTitle: '--- Lorem Ipsum ---',
    label: 'front-matter',
    icon: frontMatterIcon
  }],
  header: [{
    title: 'Header 1',
    subTitle: '# Lorem Ipsum is simply ...',
    label: 'heading 1',
    shortCut: shortcut('paragraph.h1'),
    icon: header1Icon
  }, {
    title: 'Header 2',
    subTitle: '## Lorem Ipsum is simply ...',
    label: 'heading 2',
    shortCut: shortcut('paragraph.h2'),
    icon: header2Icon
  }, {
    title: 'Header 3',
    subTitle: '### Lorem Ipsum is simply ...',
    label: 'heading 3',
    shortCut: shortcut('paragraph.h3'),
    icon: header3Icon
  }, {
    title: 'Header 4',
    subTitle: '#### Lorem Ipsum is simply ...',
    label: 'heading 4',
    shortCut: shortcut('paragraph.h4'),
    icon: header4Icon
  }, {
    title: 'Header 5',
    subTitle: '##### Lorem Ipsum is simply ...',
    label: 'heading 5',
    shortCut: shortcut('paragraph.h5'),
    icon: header5Icon
  }, {
    title: 'Header 6',
    subTitle: '###### Lorem Ipsum is simply ...',
    label: 'heading 6',
    shortCut: shortcut('paragraph.h6'),
    icon: header6Icon
  }],
  'advanced block': [{
    title: 'Table Block',
    subTitle: '|Lorem | Ipsum is simply |',
    label: 'table',
    icon: newTableIcon
  }, {
    title: 'Display Math',
    subTitle: '$$ Lorem Ipsum is simply $$',
    label: 'mathblock',
    icon: mathblockIcon
  }, {
    title: 'HTML Block',
    subTitle: '<div> Lorem Ipsum is simply </div>',
    label: 'html',
    icon: htmlIcon
  }, {
    title: 'Code Block',
    subTitle: '```java Lorem Ipsum is simply ```',
    label: 'pre',
    icon: codeIcon
  }, {
    title: 'Quote Block',
    subTitle: '>Lorem Ipsum is simply ...',
    label: 'blockquote',
    icon: quoteIcon
  }],
  'list block': [{
    title: 'Order List',
    subTitle: '1. Lorem Ipsum is simply ...',
    label: 'ol-order',
    icon: orderListIcon
  }, {
    title: 'Bullet List',
    subTitle: '- Lorem Ipsum is simply ...',
    label: 'ul-bullet',
    icon: bulletListIcon
  }, {
    title: 'To-do List',
    subTitle: '- [x] Lorem Ipsum is simply ...',
    label: 'ul-task',
    icon: todoListIcon
  }],
  diagram: [{
    title: 'Vega Chart',
    subTitle: 'Render flow chart by vega-lite.js.',
    label: 'vega-lite',
    icon: vegaIcon
  }, {
    title: 'Flow Chart',
    subTitle: 'Render flow chart by flowchart.js.',
    label: 'flowchart',
    icon: flowchartIcon
  }, {
    title: 'Sequence Diagram',
    subTitle: 'Render sequence diagram by js-sequence.',
    label: 'sequence',
    icon: sequenceIcon
  }, {
    title: 'PlantUML Diagram',
    subTitle: 'Render PlantUML diagrams',
    label: 'plantuml',
    icon: plantumlIcon
  }, {
    title: 'Mermaid',
    subTitle: 'Render Diagram by mermaid.',
    label: 'mermaid',
    icon: mermaidIcon
  }]
}
