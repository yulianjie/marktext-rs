import { filter } from 'fuzzaldrin'
import { patch, h } from '../../parser/render/snabbdom'
import { deepCopy } from '../../utils'
import BaseScrollFloat from '../baseScrollFloat'
import { quickInsertObj } from './config'
import './index.css'

class QuickInsert extends BaseScrollFloat {
  static pluginName = 'quickInsert'

  constructor (muya) {
    const name = 'ag-quick-insert'
    super(muya, name)
    this.reference = null
    this.oldVnode = null
    this._renderObj = null
    this.renderArray = null
    this.activeItem = null
    this.block = null
    this.query = ''
    this.renderObj = this.getItems()
    this.render()
    this.listen()
  }

  get renderObj () {
    return this._renderObj
  }

  translate (key, fallback, params) {
    const path = `quickInsert.${key}`
    const text = this.muya.options.translate?.(path, params)
    return text && text !== path ? text : fallback
  }

  getItems () {
    const obj = deepCopy(quickInsertObj)
    for (const items of Object.values(obj)) {
      for (const item of items) {
        const { title, subTitle, label } = item
        const heading = /^heading (\d)$/.exec(label)
        if (heading) {
          const level = Number(heading[1])
          item.title = this.translate('heading', title, { level })
          item.subTitle = this.translate('headingDescription', subTitle, { marker: '#'.repeat(level) })
        } else {
          item.title = this.translate(`items.${label}.title`, title)
          item.subTitle = this.translate(`items.${label}.description`, subTitle)
        }
        // Keep upstream English names and command IDs as search aliases.
        item.searchText = `${item.title} ${title} ${label}`
      }
    }
    return obj
  }

  refresh () {
    if (this.status) this.search(this.query, this.activeItem?.label)
  }

  set renderObj (obj) {
    this._renderObj = obj
    const renderArray = []
    Object.keys(obj).forEach(key => {
      renderArray.push(...obj[key])
    })
    this.renderArray = renderArray
    this.activeItem = null
    if (this.renderArray.length > 0) {
      this.activeItem = this.renderArray[0]
      const activeEle = this.getItemElement(this.activeItem)
      this.activeEleScrollIntoView(activeEle)
    }
  }

  render () {
    const { scrollElement, activeItem, _renderObj } = this
    let children = Object.keys(_renderObj).filter(key => {
      return _renderObj[key].length !== 0
    })
      .map(key => {
        const titleVnode = h('div.title', this.translate(`groups.${key}`, key.toUpperCase()))
        const items = []
        for (const item of _renderObj[key]) {
          const { title, subTitle, label, icon, shortCut } = item
          const iconVnode = h('div.icon-container', h('i.icon', h(`i.icon-${label.replace(/\s/g, '-')}`, {
            style: {
              background: `url(${icon}) no-repeat`,
              'background-size': '100%'
            }
          }, '')))

          const description = h('div.description', [
            h('div.big-title', title),
            h('div.sub-title', subTitle)
          ])
          const shortCutVnode = h('div.short-cut', [
            h('span', shortCut)
          ])
          const selector = activeItem.label === label ? 'div.item.active' : 'div.item'
          items.push(h(selector, {
            dataset: { label },
            on: {
              click: () => {
                this.selectItem(item)
              }
            }
          }, [iconVnode, description, shortCutVnode]))
        }

        return h('section', [titleVnode, ...items])
      })

    if (children.length === 0) {
      children = h('div.no-result', this.translate('noResults', 'No result'))
    }
    const vnode = h('div', children)

    if (this.oldVnode) {
      patch(this.oldVnode, vnode)
    } else {
      patch(scrollElement, vnode)
    }
    this.oldVnode = vnode
  }

  listen () {
    super.listen()
    const { eventCenter } = this.muya
    eventCenter.subscribe('muya-quick-insert', (reference, block, status) => {
      if (status) {
        this.block = block
        this.show(reference)
        this.search(block.text.substring(1)) // remove `@` char
      } else {
        this.hide()
      }
    })
  }

  search (text, activeLabel) {
    this.query = text
    const { contentState } = this.muya
    const canInserFrontMatter = contentState.canInserFrontMatter(this.block)
    const obj = this.getItems()
    if (!canInserFrontMatter) {
      obj['basic block'] = obj['basic block'].filter(item => item.label !== 'front-matter')
    }
    let result = obj
    if (text !== '') {
      result = {}
      Object.keys(obj).forEach(key => {
        result[key] = filter(obj[key], text, { key: 'searchText' })
      })
    }
    this.renderObj = result
    this.activeItem = this.renderArray.find(item => item.label === activeLabel) || this.activeItem
    this.render()
    this.popper?.scheduleUpdate()
  }

  selectItem (item) {
    if (!item || !this.block) return
    const { contentState } = this.muya
    this.block.text = ''
    const { key } = this.block
    const offset = 0
    contentState.cursor = {
      start: { key, offset },
      end: { key, offset }
    }
    switch (item.label) {
      case 'paragraph':
        contentState.partialRender()
        break
      default:
        contentState.updateParagraph(item.label, true)
        break
    }
    // delay hide to avoid dispatch enter hander
    setTimeout(this.hide.bind(this))
  }

  getItemElement (item) {
    const { label } = item
    return this.scrollElement.querySelector(`[data-label="${label}"]`)
  }
}

export default QuickInsert
