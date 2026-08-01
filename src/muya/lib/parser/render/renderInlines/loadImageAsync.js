import { getUniqueId, loadImage } from '../../../utils'
import { insertAfter, operateClassName } from '../../../utils/domManipulate'
import { CLASS_OR_ID } from '../../../config'

export default function loadImageAsync (imageInfo, attrs, className, imageClass) {
  const { src, isUnknownType, isLocal } = imageInfo
  let id
  let isSuccess
  let w
  let h
  let domsrc

  let reload = false
  if (this.loadImageMap.has(src)) {
    const imageInfo = this.loadImageMap.get(src)
    if (imageInfo.dispMsec !== imageInfo.touchMsec) {
      // We have a cached image, but force it to load.
      reload = true
    }
  } else {
    reload = true
  }
  if (reload) {
    id = getUniqueId()
    const requestSrc = isLocal
      ? `${src}${src.includes('?') ? '&' : '?'}msec=${Date.now()}`
      : src
    loadImage(requestSrc, isUnknownType)
      .then(({ url, width, height }) => {
        const imageText = document.querySelector(`#${id}`)
        const img = document.createElement('img')
        let dispMsec = Date.now()
        let touchMsec = dispMsec
        domsrc = url
        img.src = domsrc
        if (attrs.alt) img.alt = attrs.alt.replace(/[`*{}[\]()#+\-.!_>~:|<>$]/g, '')
        if (attrs.title) img.setAttribute('title', attrs.title)
        if (attrs.width && typeof attrs.width === 'number') {
          img.setAttribute('width', attrs.width)
        }
        if (attrs.height && typeof attrs.height === 'number') {
          img.setAttribute('height', attrs.height)
        }
        if (imageClass) {
          img.classList.add(imageClass)
        }

        if (imageText) {
          if (imageText.classList.contains('ag-inline-image')) {
            const imageContainer = imageText.querySelector('.ag-image-container')
            const oldImage = imageContainer.querySelector('img')
            if (oldImage) {
              oldImage.remove()
            }
            imageContainer.appendChild(img)
            imageText.classList.remove('ag-image-loading')
            imageText.classList.add('ag-image-success')
          } else {
            insertAfter(img, imageText)
            operateClassName(imageText, 'add', className)
          }
        }
        if (this.urlMap.has(src)) {
          this.urlMap.delete(src)
        }
        this.loadImageMap.set(src, {
          id,
          isSuccess: true,
          width,
          height,
          dispMsec,
          touchMsec,
          domsrc
        })
      })
      .catch(() => {
        const imageText = document.querySelector(`#${id}`)
        if (imageText) {
          operateClassName(imageText, 'remove', CLASS_OR_ID.AG_IMAGE_LOADING)
          operateClassName(imageText, 'add', CLASS_OR_ID.AG_IMAGE_FAIL)
          const image = imageText.querySelector('img')
          if (image) {
            image.remove()
          }
        }
        if (this.urlMap.has(src)) {
          this.urlMap.delete(src)
        }
        this.loadImageMap.set(src, {
          id,
          isSuccess: false
        })
      })
  } else {
    const imageInfo = this.loadImageMap.get(src)

    id = imageInfo.id
    isSuccess = imageInfo.isSuccess
    w = imageInfo.width
    h = imageInfo.height
    domsrc = imageInfo.domsrc
  }

  return { id, isSuccess, domsrc, width: w, height: h }
}
