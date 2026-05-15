/**
 * Compatibility shim for DOMPurify.
 *
 * Original Muya imported the named exports `sanitize` and `isValidAttribute`
 * which were available up through DOMPurify v2. In v3+ the default export is
 * the DOMPurify object and named exports were dropped — wrap them back into
 * the shape Muya consumes.
 */
import DOMPurify from 'dompurify'

const sanitize = (dirty, config) => DOMPurify.sanitize(dirty, config)

export const isValidAttribute = (tag, attr, value) =>
  typeof DOMPurify.isValidAttribute === 'function'
    ? DOMPurify.isValidAttribute(tag, attr, value)
    : true

export default sanitize
