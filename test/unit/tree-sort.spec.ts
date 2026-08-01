import { describe, expect, it } from 'vitest'

import { addFile, makeRoot, sortTree } from '../../src/stores/treeCtrl'

describe('project tree preference sorting', () => {
  function fixture() {
    const tree = makeRoot('C:/notes')
    addFile(tree, {
      name: 'b.md', pathname: 'C:/notes/b.md', isFile: true, isDirectory: false,
      isMarkdown: true, birthTime: 10, modifiedTime: 30,
    })
    addFile(tree, {
      name: 'a.md', pathname: 'C:/notes/a.md', isFile: true, isDirectory: false,
      isMarkdown: true, birthTime: 20, modifiedTime: 5,
    })
    return tree
  }

  it('sorts titles alphabetically', () => {
    const tree = fixture()
    sortTree(tree, 'title')
    expect(tree.files.map(file => file.name)).toEqual(['a.md', 'b.md'])
  })

  it('sorts created and modified times newest first', () => {
    const tree = fixture()
    sortTree(tree, 'created')
    expect(tree.files.map(file => file.name)).toEqual(['a.md', 'b.md'])
    sortTree(tree, 'modified')
    expect(tree.files.map(file => file.name)).toEqual(['b.md', 'a.md'])
  })
})
